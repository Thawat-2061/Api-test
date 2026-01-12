import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "100.112.212.19",
  port: Number(process.env.DB_PORT) || 3306,

  user: process.env.DB_USER || "apiuser",   // ❗ ไม่ควรใช้ root
  password: process.env.DB_PASS || "max123",
  database: process.env.DB_NAME || "myapp",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;


