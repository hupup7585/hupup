// Short-lived query helper for E2E checks: the in-memory server serves one connection at a time,
// so wait for the app to release its idle connection, query, and disconnect.
const { Client } = require("pg");
module.exports = async function q(sql, params = []) {
  await new Promise((r) => setTimeout(r, 400));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
};
