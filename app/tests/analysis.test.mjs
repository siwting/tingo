import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMinutesAnalysis } from '../src/analysis.ts';

test('separates migrated analysis without losing later minutes sections', () => {
  assert.deepEqual(splitMinutesAnalysis('# Meeting\n\n## Decisions\nKeep\n\n## AI 分析与建议（非会议决定）\nAdvice\n### Risk\nCheck\n## Next steps\nAct'), {
    minutes: '# Meeting\n\n## Decisions\nKeep\n\n## Next steps\nAct',
    analysis: 'Advice\n### Risk\nCheck',
  });
});
test('does not mistake fenced examples or ordinary analysis topics for AI output', () => {
  const source = '# Minutes\n```md\n## AI 分析与建议\nexample\n```\n## 问题分析\nDiscussion';
  assert.deepEqual(splitMinutesAnalysis(source), { minutes: source, analysis: '' });
});
test('supports English headings, empty minutes and tilde fences', () => {
  assert.deepEqual(splitMinutesAnalysis(''), { minutes: '', analysis: '' });
  assert.deepEqual(splitMinutesAnalysis('## AI analysis and suggestions\n~~~md\n## Example\n~~~\nAdvice\n## Decisions\nKeep'), {
    minutes: '## Decisions\nKeep', analysis: '~~~md\n## Example\n~~~\nAdvice',
  });
});

test('legacy analysis titles become minutes-style headings without changing existing Markdown', async () => {
  const { analysisMarkdown } = await import('../src/analysis.ts');
  assert.equal(analysisMarkdown('全局诊断 · 数据质量\n- 建议\n## 已有标题'), '\n## 全局诊断 · 数据质量\n\n- 建议\n## 已有标题');
  const fenced = '```text\n关键洞察 · 示例\n```';
  assert.equal(analysisMarkdown(fenced), fenced);
});

test('minutes hide only the tasks section and retain following sections and fenced examples', async () => {
  const { minutesWithoutTasks } = await import('../src/analysis.ts');
  assert.equal(minutesWithoutTasks('## 决定\n保留\n## 待办\n- 任务\n### 负责人\n甲\n## 风险\n保留'), '## 决定\n保留\n## 风险\n保留');
  assert.equal(minutesWithoutTasks('## Action items\nTask'), '');
  const example = '```md\n## 待办\nexample\n```\n## 待办事项讨论\n保留';
  assert.equal(minutesWithoutTasks(example), example);
});
