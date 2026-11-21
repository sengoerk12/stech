import { randomInt } from "node:crypto";

// Reel order matches the kiosk artwork: cherry, bell, S TECH lion, seven.
const tripleAwards = [800, 1000, 2500, 1200] as const;

export function slotAward(reels: [number, number, number]) {
  const [a, b, c] = reels;
  if (a === b && b === c) return tripleAwards[a];
  return a === b || a === c || b === c ? 500 : 0;
}

export function drawSlots() {
  const reel = () => {
    const ticket = randomInt(100);
    if (ticket < 40) return 0;
    if (ticket < 67) return 1;
    return ticket < 87 ? 2 : 3;
  };
  const reels: [number, number, number] = [reel(), reel(), reel()];
  return { reels, amount: slotAward(reels) };
}
