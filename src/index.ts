import { Context, Random, Schema } from 'koishi';
import { } from 'koishi-plugin-monetary';

export const name = 'red-packet';

export const inject = ['monetary', 'database'];

export const usage = `
---
**免责声明**

感谢您使用我们的插件！请您仔细阅读以下条款，以确保您了解并接受我们的政策：

1. **游戏性质**：本插件提供的红包游戏仅供娱乐之用，不涉及任何真实的货币交易或赌博行为。
2. **积分使用**：本插件中使用的“积分”仅为插件游戏内部使用，不具备任何货币价值，也不可兑换为现金或其他实物商品。
3. **参与条件**：使用本插件不需要支付任何费用，积分可以通过插件游戏内的活动获得。
4. **禁止赌博**：严禁使用本插件进行任何形式的赌博活动。
5. **公平竞争**：本插件旨在提供娱乐体验，所有参与者均应遵守公平竞争的原则。
6. **法律责任**：使用者必须遵守当地法律法规，若因违反相关规定而产生的任何法律后果，均由使用者自行承担。
7. **免责声明更新**：我们保留随时修改本声明的权利，请及时更新插件以获取最新版本的免责声明。**若因未及时更新插件而导致的责任和损失，本方概不负责**。
8. **解释权归属**：本声明的最终解释权归插件开发者所有。

通过使用本插件，即视为**同意上述条款**。请确保您已经仔细阅读并理解以上内容。

---
`;

export interface Config { }

export const Config: Schema<Config> = Schema.object({})

declare module 'koishi' {
  interface Tables {
    red_packet_kx: RedEnvelopeTable;
  }
}

export interface RedEnvelopeTable {
  id: number;
  sender: string;
  amount: number;
  remainingAmount: number;
  totalCount: number;
  grabbedCount: number;
  grabbedBy: number[];
  createdAt: Date;
  channelId: string; // 新增字段，记录红包所在的频道ID
}

export function apply(ctx: Context) {
  // 扩展数据库表
  ctx.model.extend('red_packet_kx', {
    id: 'integer',
    sender: 'char',
    amount: 'integer',
    remainingAmount: 'integer',
    totalCount: 'integer',
    grabbedCount: 'integer',
    grabbedBy: 'json',
    createdAt: 'date',
    channelId: 'char', // 新增字段，记录红包所在的频道ID
  }, { autoInc: true });

  // 手气红包指令
  ctx.command('packet <money:integer> <count:integer>', '发送积分手气红包', {
    checkArgCount: true
  })
    .alias('发红包')
    .action(async ({ session }, money, count) => {
      let userPoints = 0;

      const userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
      userPoints = (await ctx.database.get('monetary', { uid: userAid }, ['value']))[0]?.value;
      if (userPoints === undefined) ctx.monetary.gain(userAid, 0);
      if (userPoints < money) return `当前余额不足，你有 ${userPoints} 积分`;

      // 扣除发送者的积分
      await ctx.monetary.cost(userAid, money);

      // 创建红包并存入数据库
      await ctx.database.create('red_packet_kx', {
        sender: session.username,
        amount: money,
        remainingAmount: money,
        totalCount: count,
        grabbedCount: 0,
        grabbedBy: [],
        createdAt: new Date(),
        channelId: session.channelId, // 记录红包所在的频道ID
      });

      return `红包发送成功！金额为 ${money} 积分，共 ${count} 个。`;
    });

  // 抢红包指令
  ctx.command('packet').subcommand('snatch', '抢手气红包')
    .alias('抢红包')
    .action(async ({ session }) => {
      const userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;

      // 查找所有未抢完的红包
      const redEnvelope = await ctx.database.get('red_packet_kx', { remainingAmount: { $gt: 0 }, channelId: session.channelId }, ['id', 'sender', 'remainingAmount', 'totalCount', 'grabbedCount', 'grabbedBy']);

      if (redEnvelope.length === 0) return '当前没有可抢的红包。';

      let randomEnvelope = null;
      for (const envelope of redEnvelope) {
        if (!envelope.grabbedBy.includes(userAid) && envelope.grabbedCount < envelope.totalCount) {
          randomEnvelope = envelope;
          break;
        }
      }

      if (!randomEnvelope) return '当前没有可抢的红包。';

      let grabAmount = 0;
      if (randomEnvelope.grabbedCount + 1 === randomEnvelope.totalCount) grabAmount = randomEnvelope.remainingAmount;  // 最后一个红包抢到剩下所有金额
      else grabAmount = Random.int(1, randomEnvelope.remainingAmount); // 随机生成一个金额

      // 更新红包剩余金额和已抢个数
      await ctx.database.set('red_packet_kx', randomEnvelope.id, {
        remainingAmount: randomEnvelope.remainingAmount - grabAmount,
        grabbedCount: randomEnvelope.grabbedCount + 1,
        grabbedBy: [...randomEnvelope.grabbedBy, userAid],
      });

      // 检查红包是否被抢空
      if (randomEnvelope.remainingAmount - grabAmount <= 0 || randomEnvelope.grabbedCount + 1 >= randomEnvelope.totalCount) {
        await ctx.database.remove('red_packet_kx', { id: randomEnvelope.id });
      }

      // 增加抢红包者的积分
      await ctx.monetary.gain(userAid, grabAmount);

      return `恭喜你从【${randomEnvelope.sender}】发送的红包中抢到 ${grabAmount} 积分！`;
    });

  // 查询积分指令
  ctx.command('balance', '查询当前积分')
    .alias('查询积分')
    .action(async ({ session }) => {
      const userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
      const userPoints = (await ctx.database.get('monetary', { uid: [userAid] }, ['value']))[0]?.value;
      return `你的当前积分是 ${userPoints}。`;
    });

  // 查询当前群聊可抢红包列表指令
  ctx.command('packet.list', '查询当前群聊可抢红包列表')
    .alias('红包列表')
    .action(async ({ session }) => {
      // 查找当前群聊中所有未抢完的红包
      const redEnvelopes = await ctx.database.get('red_packet_kx', { remainingAmount: { $gt: 0 }, channelId: session.channelId }, ['id', 'sender', 'totalCount', 'grabbedCount']);

      if (redEnvelopes.length === 0) return '当前没有可抢的红包。';

      let response = '当前可抢的红包列表：\n';
      redEnvelopes.forEach((envelope, index) => {
        response += `${index + 1}. 发送者: ${envelope.sender}, 剩余个数: ${envelope.totalCount - envelope.grabbedCount}\n`;
      });

      return response;
    });
}