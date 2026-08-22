import { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { env } from '../config/env';

let modelInstance: LanguageModel | undefined;

export const MISSING_KEY_MESSAGE =
    'Falta GOOGLE_GENERATIVE_AI_API_KEY en tu .env. Genera una en https://aistudio.google.com/apikey y actualiza tu .env';

export const getModel = (): LanguageModel => {
    if (!modelInstance) {
        if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
            throw new Error(MISSING_KEY_MESSAGE);
        }
        modelInstance = createGoogleGenerativeAI({
            apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
        })(env.MODEL_NAME);
    }
    return modelInstance;
};