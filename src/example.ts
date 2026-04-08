/**
 * IronMind — 使用示例（含持久化闭环）
 *
 * 运行方式：npx ts-node src/example.ts
 */

import { WorkoutSessionService, SubmitSetResult } from './WorkoutSessionService';
import { LocalDatabaseService } from './LocalDatabaseService';
import { UserConfig, MacroConstraint } from './types';

// ── 1. 用户配置 ──────────────────────────────────────────────────────────────

const userConfig: UserConfig = {
  userId: 'user-001',
  name: 'Alex',
  trainingGoal: 'Strength',
  rpeCalibration: {
    isMocked: true,
    profile: 'Mocked_Veteran_LVP',
    underreportingFactor: 1.15,
  },
};

// ── 2. 晨间宏观约束 ──────────────────────────────────────────────────────────

const todayMacro: MacroConstraint = {
  date: '2026-04-08',
  deltaHRV: -0.08,
  hrvStatus: 'Yellow',
  maxRPECap: 8.5,
  volumeModifier: -1,
  loadModifier: 0,
  isMeltdown: false,
};

// ── 3. 依赖注入：LocalDatabaseService → WorkoutSessionService ────────────────

const db = new LocalDatabaseService();
const session = new WorkoutSessionService(userConfig, todayMacro, db);

// ── 4. 训练主流程 ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(68));
  console.log(` IronMind | ${userConfig.name} | ${todayMacro.date}`);
  console.log(` 目标: ${userConfig.trainingGoal}  |  HRV: ${todayMacro.hrvStatus} (-8%)  |  RPE Cap: ${todayMacro.maxRPECap}`);
  console.log('═'.repeat(68));

  // SET 1 — 场景 D：状态极佳
  console.log('\n◆ SET 1 — 状态探测组');
  const r1 = session.submitSet('squat', {
    targetLoad: 100, targetReps: 5,
    actualLoad: 100, actualReps: 5,
    userRPE: 6.0,
    firstRepDurationSec: 2.0,
    lastRepDurationSec: 2.1,     // VL = 5%
  });
  printResult(r1);

  // SET 2 — 场景 B：心理疲劳 vs 神经质量
  console.log('\n◆ SET 2 — 心理疲劳 vs 神经质量');
  const r2 = session.submitSet('squat', {
    actualLoad: r1.suggestion.load,
    actualReps: r1.suggestion.reps,
    userRPE: 8.0,
    firstRepDurationSec: 2.0,
    lastRepDurationSec: 2.24,    // VL = 12%
  });
  printResult(r2);

  // SET 3 — 场景 A：真实力竭
  console.log('\n◆ SET 3 — 真实力竭');
  const r3 = session.submitSet('squat', {
    actualLoad: r2.suggestion.load,
    actualReps: r2.suggestion.reps,
    userRPE: 9.0,
    firstRepDurationSec: 2.0,
    lastRepDurationSec: 2.36,    // VL = 18%
  });
  printResult(r3);

  // SET 4 — 硬熔断
  console.log('\n◆ SET 4 — 虚报 RPE / 硬熔断触发');
  const r4 = session.submitSet('squat', {
    actualLoad: r3.suggestion.load,
    actualReps: r3.suggestion.reps,
    userRPE: 6.5,
    firstRepDurationSec: 2.0,
    lastRepDurationSec: 2.76,    // VL = 38%
  });
  printResult(r4);

  // ── 5. 结束 Session，持久化 ─────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(68));
  console.log(' 正在保存训练数据...');

  const savedSession = await session.finishSession();

  const totalCount = await db.getTotalCount();
  const history    = await db.getUserHistory(userConfig.userId);

  console.log(` ✓ 数据已成功保存至 data/mock_db.json`);
  console.log(` ✓ SessionId  : ${savedSession.sessionId}`);
  console.log(` ✓ 完成组数   : ${Object.values(savedSession.exercises).reduce((n, e) => n + e.completedSets.length, 0)} 组`);
  console.log(` ✓ 数据库共计 : ${totalCount} 条 Session 记录`);
  console.log(` ✓ ${userConfig.name} 累计训练日 : ${history.length} 天`);
  console.log('═'.repeat(68));
}

// ── 辅助打印 ─────────────────────────────────────────────────────────────────

function printResult(r: SubmitSetResult) {
  const { setRecord, suggestion, aiReasoning } = r;
  const vlPct = `${(setRecord.velocityLossPercent * 100).toFixed(0)}%`;
  console.log(`  ┌─ ${setRecord.setId}`);
  console.log(`  │  effectiveRPE: ${setRecord.effectiveRPE.toFixed(1)}  |  VL: ${vlPct}  |  策略: ${suggestion.decisionStrategy}`);
  console.log(`  │  下一组建议  : ${suggestion.load} kg × ${suggestion.reps} 次，休息 ${suggestion.restSec}s`);
  console.log(`  └─ 🤖 AI 教练：`);
  wrapText(aiReasoning, 60).forEach(line => console.log(`       ${line}`));
}

function wrapText(text: string, maxLen: number): string[] {
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cutAt = maxLen;
    for (let i = maxLen; i > maxLen - 15; i--) {
      const ch = remaining[i];
      if (ch === '。' || ch === '，' || ch === ' ' || ch === '；') {
        cutAt = i + 1;
        break;
      }
    }
    result.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  if (remaining.length > 0) result.push(remaining);
  return result;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
