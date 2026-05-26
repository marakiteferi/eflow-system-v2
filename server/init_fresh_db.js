require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

async function run() {
    console.log("Connecting to default Postgres database to create eflow_demo...");
    const rootClient = new Client({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: 'postgres'
    });
    
    await rootClient.connect();
    try {
        await rootClient.query('DROP DATABASE IF EXISTS eflow_demo');
        await rootClient.query('CREATE DATABASE eflow_demo');
        console.log("✅ Created database eflow_demo.");
    } catch(err) {
        console.error("❌ Error creating DB:", err);
    } finally {
        await rootClient.end();
    }

    console.log("Connecting to eflow_demo to build schema...");
    const dbClient = new Client({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: 'eflow_demo'
    });
    await dbClient.connect();

    try {
        const runSqlFile = async (filePath) => {
            console.log(`Running ${path.basename(filePath)}...`);
            const sql = fs.readFileSync(filePath, 'utf8');
            if (sql.trim()) {
                await dbClient.query(sql);
            }
        };

        // 1. Base schema
        await runSqlFile(path.join(__dirname, 'eflow_db_2_schema.sql'));

        // 2. Root Migrations
        const migDir1 = path.join(__dirname, 'migrations');
        if (fs.existsSync(migDir1)) {
            const mig1 = fs.readdirSync(migDir1).filter(f => f.endsWith('.sql')).sort();
            for(let f of mig1) {
                await runSqlFile(path.join(migDir1, f));
            }
        }

        // 3. Src Migrations
        const migDir2 = path.join(__dirname, 'src', 'migrations');
        if (fs.existsSync(migDir2)) {
            const mig2 = fs.readdirSync(migDir2).filter(f => f.endsWith('.sql')).sort();
            for(let f of mig2) {
                await runSqlFile(path.join(migDir2, f));
            }
        }

        // 4. Setup Custom Admin User
        const hash = await bcrypt.hash('123', 10);
        
        // Remove legacy seed from schema
        await dbClient.query("DELETE FROM users WHERE email = 'admin@eflow.edu'");
        
        await dbClient.query(
            "INSERT INTO users (name, email, password_hash, role_id) VALUES ($1, $2, $3, 3)",
            ['Super Admin', 'marakiteferi2@gmail.com', hash]
        );
        console.log("✅ User marakiteferi2@gmail.com seeded successfully with password '123'!");

    } catch(err) {
        console.error("❌ Error running schemas:", err.message);
    } finally {
        await dbClient.end();
    }
}

run();
