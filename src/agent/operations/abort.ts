/**
 * 中断检查 —— 用户点了"停止"
 *
 * 放在管线【最前面】，因为中断的优先级最高：
 * 用户明确说了"停"，就不该再发一次 LLM 请求（那是在烧钱）。
 *
 * ⚠️ 为什么这里返回"已中断"这句话而不是空字符串：
 *   用户点停止后，面板上要有一句交代。
 *   而且"上面已完成的部分保留在对话里，可以直接接着说下一步"
 *   这句话是【产品承诺】——它告诉用户不用重头再来。
 */

import { Operation, OperationResult, notApplicable, yielded } from './types';

export const abortOperation: Operation = {
  name: 'abort',

  async run(ctx): Promise<OperationResult> {
    if (!ctx.signal?.aborted) return notApplicable();

    return yielded(
      '[已中断] 任务被用户手动停止。上面已完成的部分保留在对话里，可以直接接着说下一步。',
    );
  },
};
