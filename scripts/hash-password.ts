import bcrypt from "bcryptjs";

const password = process.argv[2] || process.env.ADMIN_PASSWORD;
if (!password) {
  console.error("Usage: bun run hash:admin <password>  (or set ADMIN_PASSWORD)");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
