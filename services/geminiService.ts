import { GoogleGenAI } from "@google/genai";

export const generateSmartDescription = async (
  configCount: number, 
  tehranTime: string
): Promise<string> => {
  // Use process.env.API_KEY directly as per SDK guidelines.
  // We assume the environment is configured to provide this, e.g. via Vite define.
  if (!process.env.API_KEY) {
    return `V2Ray Sub | Count: ${configCount} | ${tehranTime}`;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Create a short, professional, and slightly emojis summary for a V2Ray Subscription gist.
      
      Data:
      - Config Count: ${configCount}
      - Generated At (Tehran Time): ${tehranTime}
      - Context: Optimized for low latency and censorship circumvention.
      
      Format: Keep it under 150 characters. Mention the date and count clearly.
      Language: English mixed with Persian (Finglish or Persian) is okay, but keep it readable.
      `,
    });
    
    return response.text?.trim() || `V2Ray Sub | Count: ${configCount} | ${tehranTime}`;
  } catch (error) {
    console.error("Gemini Error:", error);
    return `V2Ray Sub | Count: ${configCount} | ${tehranTime}`;
  }
};