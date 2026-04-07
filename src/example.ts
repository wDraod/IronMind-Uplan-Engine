/**
 * IronMind — 使用示例
 *
 * 模拟一名力量目标用户的深蹲训练：
 *   - 今日 HRV 轻微下降（Yellow 区），轻度限制
 *   - 连续三组，演示引擎如何实时调整建议
 *
 * 运行方式：npx ts-node src/example.ts
 */

import { WorkoutSessionService } from './WorkoutSessionService';
import { UserConfig, MacroConstraint } from './types';

// ── 1. 配置用户 ─────────────────────────────────────────────────────────────

const userConfig: UserConfig = {
  userId: 'user-001',
  name: 'Alex',
  trainingGoal: 'Strength',
  rpeCalibration: {
    isMocked: true,
    profile: 'Mocked_Veteran_LVP',
    underreportingFactor: 1.15, // 资深用户习惯低报 RPE ~15%
  },
};

// ── 2. 晨间约束（来自宏观引擎，这里手动构造模拟数据） ────────────────────────

const todayMacro: MacroConstraint = {
  date: '2026-04-07',
  deltaHRV: -0.08,        // HRV 下降 8%，落入 Yellow 区
  hrvStatus: 'Yellow',
  maxRPECap: 8.5,         // 今日 RPE 上限
  volumeModifier: -1,     // 力量目标下：砍 1 组
  loadModifier: 0,        // 保重量
  isMeltdown: false,
};

// ── 3. 实例化 Session 服务 ──────────────────────────────────────────────────

const session = new WorkoutSessionService(userConfig, todayMacro);

console.log('='.repeat(60));
console.log(`IronMind Session 开始 | ${userConfig.name} | ${todayMacro.date}`);
console.log(`训练目标: ${userConfig.trainingGoal} | HRV 状态: ${todayMacro.hrvStatus}`);
console.log('='.repeat(60));

// ── 4. 模拟三组深蹲 ─────────────────────────────────────────────────────────

// 第 1 组：热身结束，状态良好
console.log('\n▶ 第 1 组');
const result1 = session.submitSet('squat', {
  targetLoad: 100,
  targetReps: 5,
  actualLoad: 100,
  actualReps: 5,
  userRPE: 6.5,                // 用户感觉良好
  firstRepDurationSec: 2.0,
  lastRepDurationSec: 2.1,     // VL = 5%，状态极佳
});
printResult(result1.setRecord.setId, result1.suggestion);

// 第 2 组：感觉开始吃力，VL 上升
console.log('\n▶ 第 2 组');
const result2 = session.submitSet('squat', {
  actualLoad: result1.suggestion.load,   // 使用上一组建议的重量
  actualReps: result1.suggestion.reps,
  userRPE: 7.0,
  firstRepDurationSec: 2.0,
  lastRepDurationSec: 2.24,    // VL = 12%，进入疲劳区间
});
printResult(result2.setRecord.setId, result2.suggestion);

// 第 3 组：用户低报 RPE（填 6.5），但测得 VL 骤升至 38% → 触发硬熔断
console.log('\n▶ 第 3 组（虚报 RPE 边缘 Case）');
const result3 = session.submitSet('squat', {
  actualLoad: result2.suggestion.load,
  actualReps: result2.suggestion.reps,
  userRPE: 6.5,                // ⚠️ 用户虚报 RPE，实际已力竭
  firstRepDurationSec: 2.0,
  lastRepDurationSec: 2.76,    // VL = 38% >> Strength 阈值 20%
});
printResult(result3.setRecord.setId, result3.suggestion);

// ── 5. Session 快照（供前端持久化或同步） ────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('Session 快照（exercises）:');
const snapshot = session.getSessionSnapshot();
const squatState = snapshot.exercises['squat'];
console.log(`  深蹲完成组数: ${squatState.completedSets.length}`);
console.log(`  最近 VL 趋势: [${squatState.recentVelocityLosses.map(v => (v * 100).toFixed(1) + '%').join(', ')}]`);
console.log('='.repeat(60));

// ── 辅助打印 ─────────────────────────────────────────────────────────────────

function printResult(setId: string, suggestion: ReturnType<typeof session.submitSet>['suggestion']) {
  console.log(`  setId      : ${setId}`);
  console.log(`  策略       : ${suggestion.decisionStrategy}`);
  console.log(`  下一组建议 : ${suggestion.load} kg × ${suggestion.reps} 次，休息 ${suggestion.restSec}s`);
  console.log(`  推理       : ${suggestion.aiReasoning}`);
}
