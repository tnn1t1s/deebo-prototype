// Get the ISO week number for a date
function getWeekNumber(d: Date): string {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

// Generate 57 unique hashes
const hashes = Array.from({ length: 57 }, (_, i) => 
  `seed-${i.toString().padStart(3, '0')}`
);

// Get current week
const currentWeek = getWeekNumber(new Date());

// Format KV entries
const entries = hashes.map(hash => ({
  key: `${currentWeek}:${hash}`,
  value: new Date().toISOString(),
  expiration: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
}));

console.log(JSON.stringify(entries));
