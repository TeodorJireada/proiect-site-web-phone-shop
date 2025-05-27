const cookieParser = require('cookie-parser');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const bodyParser = require('body-parser')
const fs = require('fs');
const { fail } = require('assert');
const app = express();
const port = 6789;
const sqlite3 = require('sqlite3').verbose();
const blockedIPs = new Map();
const failedLogins = new Map();

app.set('view engine', 'ejs');
app.use(cookieParser());
app.use(expressLayouts);
app.use(express.static('public'))
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'cheie_secreta',
    resave: false,
    saveUninitialized: true,
    cookie: {secure: false}
}));

app.use((req, res, next) => {    
    res.locals.user = req.session.user;
    next();
});

app.use((req, res, next) => {
    const ip = req.ip;
    const blockUntil = blockedIPs.get(ip);

    if (blockUntil && Date.now() < blockUntil) {
        return res.status(403).send('Acces temporar blocat. Încearcă mai târziu.');
    } else if (blockUntil) {
        blockedIPs.delete(ip);
    }

    next();
});

app.get('/', (req, res) => {
    const db = new sqlite3.Database('./cumparaturi.db', sqlite3.OPEN_READWRITE, (err) => {
        if(err){
            console.error("Eroare la incarcarea db: ", err);
            return;
        }

        const query = 'SELECT * FROM produse';

        db.all(query, [], (err, rows) => {
            if(err){
                console.error("Eroare db: ", err);
                return;
            }
            res.render('index', { user: req.session.user, db: rows });
        });
    });
});

app.get('/autentificare', (req, res) => {
    const eroare = req.session.loginError;
    req.session.loginError = null;
    res.render('autentificare', {  eroare });
});

app.get('/deconectare', (req, res) => {
    req.session.user = null;
    req.session.destroy((err) => {
        if(err){
            return res.redirect('/');
        }
        res.redirect('/');
    });
});

app.post('/verificare-autentificare', (req, res) =>{
    console.log(req.body);
    const user = req.body.user;
    const pass = req.body.pass;
    const ip = req.ip;

    const key = `${ip}`;
    const record = failedLogins.get(key);

    if(record && record.count >= 5){
        const remaining = record.lastAttempt + 10000 - Date.now();
        if(remaining > 0){
            blockedIPs.set(ip, Date.now() + 10000);
            failedLogins.delete(key);
            return res.status(429).send(`Prea multe încercări nereușite. Mai încearcă în ${Math.ceil(remaining/1000)}s`);
        } else {
            failedLogins.delete(key);
        }
    }

    if(user === 'admin' && pass === 'admin'){
        failedLogins.delete(key);
        req.session.user = user;
        return res.redirect('/admin');
    }

    fs.readFile('utilizatori.json', (err, data) => {
        if(err) throw err;
        const users = JSON.parse(data);
        const match = users.find( u => u.user === user && u.pass === pass );
        if(match){
            failedLogins.delete(key);
            req.session.user = user;
            res.redirect('/');
        } else {
            const now = Date.now();
            if (!record) {
                failedLogins.set(key, { count: 1, lastAttempt: now });
            } else {
                failedLogins.set(key, { count: record.count + 1, lastAttempt: now });
            }

            req.session.loginError = 'Utilizator sau parola incorecte!';
            res.redirect('/autentificare');
        }
    });
});

app.get('/admin', (req, res) => {
    if(req.session.user !== 'admin') return res.redirect('/autentificare');
    
    const db = new sqlite3.Database('./cumparaturi.db', sqlite3.OPEN_READONLY, (err, rows) => {
        if(err){
            console.error("Eroare db: ", err);
            return res.status(500).send("Database error");
        }
        
        const query = 'SELECT * FROM produse';

        db.all(query, [], (err, rows) => {
            if(err){
                console.error("Eroare db: ", err);
                return;
            }
            res.render('admin', { db: rows });
        });
    });
});

app.post('/admin/add-item', (req, res) => {
    if(req.session.user !== 'admin') return res.status(403).send('Forbidden');

    const {produs, pret} = req.body;

    const db = new sqlite3.Database('./cumparaturi.db', sqlite3.OPEN_READWRITE, (err) => {
        if(err){
            console.error("Eroare la incarcarea db: ", err);
            return res.status(500).send("Eroare db");
        }

        const query = 'INSERT INTO produse(nume, pret) VALUES (?, ?)';

        db.run(query, [produs, pret], (err) => {
            if(err){
                console.error("Eroare db: ", err);
                return res.status(500).send('Eroare inserare produs');
            }
            db.close();

            res.redirect('/admin');
        });
    });
});

app.get('/chestionar', (req, res) => {
    fs.readFile('intrebari.json', (err, data) =>{
        if(err) throw err;
        const listaIntrebari = JSON.parse(data);
        res.render('chestionar', {intrebari: listaIntrebari});
    });
});

app.post('/rezultat-chestionar', (req, res) => {
    fs.readFile('intrebari.json', (err, data) =>{
        if(err) throw err;
        const listaIntrebari = JSON.parse(data);

        let scor = 0;
        listaIntrebari.forEach((intrebare, index) =>{
            const raspunsUtilizator = req.body[`q${index}`];
            if (parseInt(raspunsUtilizator) === intrebare.corect){
                scor++;
            }
        });

        res.render('rezultat-chestionar', { scor: scor, total: listaIntrebari.length });
    });
});

app.get('/creare-bd', (req, res) => {
    const db = new sqlite3.Database('./cumparaturi.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('Eroare la crearea bazei de date:', err.message);
            return; 
        }

        const query = `
            CREATE TABLE IF NOT EXISTS produse(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nume TEXT NOT NULL,
                pret REAL
            );
        `;
            
        db.exec(query, (err) =>{
            if(err){
                console.error('Eroare creare tabelă');
                return;
            }
            console.log('Creare tabela OK');
            
            res.redirect('/'); 
        });
    });
});

app.get('/inserare-bd', (req, res) => {
    const db = new sqlite3.Database('./cumparaturi.db', sqlite3.OPEN_READWRITE, (err) => {
        if(err){
            console.error('Eroare la deschiderea bazei de date');
            return;
        }
        
        const query = `
            INSERT INTO produse (nume, pret) VALUES
            ('Nothing Phone 2a PRO', 2499.98);
        `;
        
        db.exec(query, (err) => {
            if(err){
                console.error('Eroare inserare elemente');
                return;
            }
            console.log('Inserare elemente OK');
            res.redirect('/');
        });
    });
});

app.post('/adaugare-cos', (req, res) => {
    const idProdus = parseInt(req.body.idProdus);

    if(!req.session.cart){
        req.session.cart = [];
    }

    req.session.cart.push(idProdus);

    console.log(req.session.cart);

    res.redirect('/');
});

app.get('/vizualizare-cos', (req, res) => {
    const db = new sqlite3.Database('./cumparaturi.db', sqlite3.OPEN_READONLY, (err) => {
        if(err){
            console.error("Eroare", err);
        } 

        const query = 'SELECT * FROM produse';

        db.all(query, [], (err, rows) => {
            if(err){
                console.error("Eroare db: ", err);
                return;
            }

            const ids = req.session.cart || [];    //sau gol
            const produseCos = rows.filter(pr => ids.includes(pr.id));
            
            res.render('vizualizare-cos', { cos: produseCos });
        });
    });
});

app.use((req, res, next) => {
    res.status(404).send('Error 404: Not found');
});


app.listen(port, () => console.log(`Serverul rulează la adresa http://localhost::${port}/`));