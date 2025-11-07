import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

let client: OpenAI | null = null;

const getClient = () => {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing OPENAI_API_KEY. Set it in your environment or .env file before running Agent Builder."
      );
    }
    client = new OpenAI({
      apiKey
    });
  }
  return client;
};

export class OpenAIClient {
  static async generate(prompt: string, model?: string): Promise<string> {
    const response = await getClient().chat.completions.create({
      model: model ?? process.env.OPENAI_MODEL ?? "gpt-4-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });
    return response.choices[0]?.message?.content ?? "";
  }

  static async embed(input: string, model?: string): Promise<number[] | null> {
    try {
      const response = await getClient().embeddings.create({
        model: model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large",
        input
      });
      return response.data[0]?.embedding ?? null;
    } catch (error) {
      if (process.env.OPENAI_API_KEY) {
        throw error;
      }
      return null;
    }
  }
}
