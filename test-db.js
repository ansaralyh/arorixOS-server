const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'arorixOS',
  password: 'root',
  port: 5432,
});

async function check() {
  const res1 = await pool.query("SELECT email, phone FROM users WHERE email = 'test_new_fields2@example.com'");
  console.log("Users:", res1.rows);
  
  const res2 = await pool.query("SELECT name, entity_type, industry, state, email, phone, is_paid FROM businesses WHERE email = 'test_new_fields2@example.com'");
  console.log("Businesses:", res2.rows);
  
  pool.end();
}

check();