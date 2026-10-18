import { Agent, Model, tool, type BaseModelConfig, type StreamOptions, type ModelStreamEvent, type Message } from '@strands-agents/sdk';

class NoInferenceModel extends Model {
  private config: BaseModelConfig = { modelId: 'no-inference' };
  updateConfig(value: BaseModelConfig): void { this.config = { ...this.config, ...value }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(_messages: Message[], _options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    throw new Error('Basic Pitch tool never invokes a language model');
  }
}

// Direct Strands tool invocation runs Basic Pitch without asking a second model
// to decide whether to call it. The closure keeps raw WAV bytes out of tool
// arguments and agent history.
export async function invokeBasicPitch<T>(artifactId: string, analyze: () => Promise<T>): Promise<T> {
  let measured: T | undefined;
  const basicPitch = tool({
    name: 'basic_pitch', description: 'Analyze the uploaded WAV with the laptop Basic Pitch service.',
    inputSchema: { type: 'object', properties: { artifactId: { type: 'string' } }, required: ['artifactId'] },
    callback: async (input: unknown) => {
      if (!input || typeof input !== 'object' || (input as { artifactId?: unknown }).artifactId !== artifactId) {
        throw new Error('artifact mismatch');
      }
      measured = await analyze();
      return { completed: true };
    }
  });
  const workflow = new Agent({ model: new NoInferenceModel(), tools: [basicPitch], printer: false });
  const result = await workflow.tool.basic_pitch.invoke({ artifactId }, { recordDirectToolCall: false });
  if (result.status !== 'success' || measured === undefined) throw result.error ?? new Error('Basic Pitch tool failed');
  return measured;
}
