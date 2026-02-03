// Replaced AI generation with static formatter to remove dependency
export const generateSmartDescription = async (
  configCount: number, 
  tehranTime: string
): Promise<string> => {
  const emojis = ['🚀', '⚡', '🛡️', '🌐', '🔥', '✨'];
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  
  return `V2Ray Sub ${randomEmoji} | Servers: ${configCount} | Updated: ${tehranTime}`;
};
