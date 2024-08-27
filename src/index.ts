import { Context, Random, Schema } from 'koishi';
import { } from 'koishi-plugin-monetary';

export const name = 'red-packet';

export const inject = ['monetary', 'database'];

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
  }, { autoInc: true });

  // 手气红包指令
  ctx.command('packet <money:integer> <count:integer>', '发送积分手气红包', {

    checkArgCount: true
  })
    .alias('发送红包')
    .action(async ({ session }, money, count) => {
      let userPoints = 0;
      let userAid: number;

      userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
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
      });

      return `红包发送成功！金额为 ${money} 积分，共 ${count} 个。`;
    });

  // 抢红包指令
  ctx.command('packet').subcommand('snatch', '抢手气红包')
    .alias('抢红包')
    .action(async ({ session }) => {
      const userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;

      // 查找所有未抢完的红包
      const redEnvelope = await ctx.database.get('red_packet_kx', { remainingAmount: { $gt: 0 } }, ['id', 'sender', 'remainingAmount', 'totalCount', 'grabbedCount', 'grabbedBy']);

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

      return `恭喜你从 ${randomEnvelope.sender} 发送的红包中抢到 ${grabAmount} 积分！`;
    });

  // 查询积分指令
  ctx.command('balance', '查询当前积分')
    .alias('查询积分')
    .action(async ({ session }) => {
      const userAid = (await ctx.database.get('binding', { pid: [session.userId] }, ['aid']))[0]?.aid;
      const userPoints = (await ctx.database.get('monetary', { uid: [userAid] }, ['value']))[0]?.value;
      return `你的当前积分是 ${userPoints}。`;
    });
}