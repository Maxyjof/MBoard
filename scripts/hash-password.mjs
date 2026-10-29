#!/usr/bin/env node
// 生成 bcrypt 哈希，用于 config/accounts.yml 的 passwordHash 字段
import bcrypt from "bcryptjs";

const plain = process.argv[2];

if (!plain) {
  console.log("用法: npm run hash -- \"你的密码\"");
  process.exit(1);
}

const hash = bcrypt.hashSync(plain, 10);
console.log("\n把下面这行写进 config/accounts.yml（替换 password 字段）:\n");
console.log(`    passwordHash: "${hash}"\n`);
