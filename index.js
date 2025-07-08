const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

app.use(session({
  secret: 'chave-supersecreta',
  resave: false,
  saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./db.sqlite', (err) => {
  if (err) return console.error(err.message);
  console.log('Conectado ao banco SQLite.');

  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    status TEXT NOT NULL,
    criado_por TEXT,
    criado_em TEXT,
    alterado_por TEXT,
    alterado_em TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL,
    nivel TEXT NOT NULL
  )`);

  db.get(`SELECT * FROM usuarios WHERE nome = 'admin'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO usuarios (nome, senha, nivel) VALUES (?, ?, ?)`, ['admin', '1234', 'admin']);
      console.log('Usuário admin criado com senha 1234');
    }
  });
});

function verificarLogin(req, res, next) {
  if (req.session.usuario) next();
  else res.redirect('/login');
}

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  db.get(`SELECT * FROM usuarios WHERE nome = ? AND senha = ?`, [usuario, senha], (err, row) => {
    if (row) {
      req.session.usuario = row.nome;
      req.session.nivel = row.nivel;
      res.redirect('/painel');
    } else {
      res.send('Login inválido. <a href="/login">Tente novamente</a>');
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/painel', verificarLogin, (req, res) => {
  db.all('SELECT * FROM clientes', [], (err, rows) => {
    if (err) {
      res.send('Erro ao carregar clientes.');
    } else {
      let html = `
      <link rel="stylesheet" href="/style.css">
      <h2>Painel de Clientes</h2>
      <a href="/logout">Sair</a>`;
      if (req.session.nivel === 'admin') {
        html += ` | <a href="/usuarios">Gerenciar Usuários</a>`;
      }
      html += `<ul>`;

      rows.forEach(cliente => {
        html += `
        <li>
          <span class="${cliente.status === 'pago' ? 'status-pago' : 'status-nao'}">
            ${cliente.nome} - ${cliente.status.toUpperCase()}
          </span>
          <div style="font-size:12px;">
            Criado por: ${cliente.criado_por || '-'} em ${cliente.criado_em || '-'}<br>
            Última alteração: ${cliente.alterado_por || '-'} em ${cliente.alterado_em || '-'}
          </div>`;

        if (req.session.nivel === 'admin') {
          html += `
          <div>
            <a href="/toggle/${cliente.id}">[Alternar]</a>
            <a href="/editar/${cliente.id}">[Editar]</a>
            <a href="/deletar/${cliente.id}">[Deletar]</a>
          </div>`;
        }

        html += `</li>`;
      });

      html += `</ul>`;

      if (req.session.nivel === 'admin') {
        html += `
        <form method="post" action="/novo-cliente">
          <input name="nome" placeholder="Novo cliente" required>
          <button>Adicionar</button>
        </form>`;
      }

      res.send(html);
    }
  });
});

app.post('/novo-cliente', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const nome = req.body.nome;
  const agora = new Date().toLocaleString();
  db.run(`INSERT INTO clientes (nome, status, criado_por, criado_em, alterado_por, alterado_em)
          VALUES (?, ?, ?, ?, ?, ?)`,
    [nome, 'nao-pago', req.session.usuario, agora, req.session.usuario, agora],
    () => res.redirect('/painel'));
});

app.get('/toggle/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  const agora = new Date().toLocaleString();
  db.get('SELECT status FROM clientes WHERE id = ?', [id], (err, row) => {
    if (!row) return res.redirect('/painel');
    const novoStatus = row.status === 'pago' ? 'nao-pago' : 'pago';
    db.run(`UPDATE clientes SET status = ?, alterado_por = ?, alterado_em = ? WHERE id = ?`,
      [novoStatus, req.session.usuario, agora, id],
      () => res.redirect('/painel'));
  });
});

app.get('/editar/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  db.get('SELECT * FROM clientes WHERE id = ?', [id], (err, row) => {
    if (!row) return res.redirect('/painel');
    res.send(`
      <form method="post" action="/editar/${id}">
        <input name="nome" value="${row.nome}" required>
        <button type="submit">Salvar</button>
      </form>
      <a href="/painel">Cancelar</a>
    `);
  });
});

app.post('/editar/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  const nome = req.body.nome;
  const agora = new Date().toLocaleString();
  db.run('UPDATE clientes SET nome = ?, alterado_por = ?, alterado_em = ? WHERE id = ?',
    [nome, req.session.usuario, agora, id],
    () => res.redirect('/painel'));
});

app.get('/deletar/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  db.run('DELETE FROM clientes WHERE id = ?', [id], () => {
    res.redirect('/painel');
  });
});

app.get('/usuarios', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');

  db.all('SELECT * FROM usuarios', [], (err, rows) => {
    let html = `
      <link rel="stylesheet" href="/style.css">
      <h2>Gerenciar Usuários</h2>
      <a href="/painel">Voltar</a>
      <ul>`;

    rows.forEach(user => {
      html += `<li>
        ${user.nome} - ${user.nivel.toUpperCase()}
        ${user.nome !== 'admin' ? `<a href="/excluir-usuario/${user.id}">[Excluir]</a>` : ''}
      </li>`;
    });

    html += `</ul>
    <form method="post" action="/criar-usuario">
      <input name="nome" placeholder="Novo usuário" required>
      <input name="senha" placeholder="Senha" required>
      <select name="nivel">
        <option value="normal">Normal</option>
        <option value="admin">Admin</option>
      </select>
      <button>Criar</button>
    </form>`;

    res.send(html);
  });
});

app.post('/criar-usuario', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const { nome, senha, nivel } = req.body;

  db.run('INSERT INTO usuarios (nome, senha, nivel) VALUES (?, ?, ?)', [nome, senha, nivel], () => {
    res.redirect('/usuarios');
  });
});

app.get('/excluir-usuario/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  db.run('DELETE FROM usuarios WHERE id = ?', [id], () => {
    res.redirect('/usuarios');
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
