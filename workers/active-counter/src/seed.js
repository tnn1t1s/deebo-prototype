import { getWeekNumber } from './worker';
// Generate 13 unique hashes
const hashes = Array.from({ length: 13 }, (_, i) => `seed-${i.toString().padStart(3, '0')}`);
// Get current week
const currentWeek = getWeekNumber(new Date());
// Format KV entries
const entries = hashes.map(hash => ({
    key: `${currentWeek}:${hash}`,
    value: new Date().toISOString(),
    expiration: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
}));
console.log('Add these entries to your KV namespace:');
console.log(JSON.stringify(entries, null, 2));
