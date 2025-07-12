const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');

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
    device TEXT,
    valor TEXT,
    obs TEXT,
    status TEXT NOT NULL
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

app.get('/', (req, res) => {
  res.redirect('/login');
});


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
      <div class="painel-clientes">
        <header>
          <h1>Clientes</h1>
          <div>
            <a href="/logout">Sair</a>
            ${req.session.nivel === 'admin' ? '<a href="/usuarios">Gerenciar Usuários</a>' : ''}
            ${req.session.nivel === 'admin' ? '<button onclick="abrirModal()">Novo Cliente</button>' : ''}
            ${req.session.nivel === 'admin' ? '<button onclick="forcarVerificacao()">Forçar Verificação</button>' : ''}
          </div>
        </header>
        <ul>`;

      rows.forEach(cliente => {
        html += `
        <li>
          <span class="${cliente.status === 'pago' ? 'status-pago' : 'status-nao'}">
            ${cliente.nome} - ${cliente.status.toUpperCase()}
          </span>
          <div class="cliente-detalhes">
            Device: ${cliente.device || '-'}<br>
            Valor: ${cliente.valor || '-'}<br>
            OBS: ${cliente.obs || '-'}<br>
          </div>`;

        if (req.session.nivel === 'admin') {
          html += `
          <div class="cliente-acoes">
            <a href="/toggle/${cliente.id}">[Alternar]</a>
            <a href="/editar-cliente/${cliente.id}">[Editar]</a>
            <a href="/deletar-cliente/${cliente.id}">[Deletar]</a>
          </div>`;
        }

        html += `</li>`;
      });

      html += `</ul></div>`;

      if (req.session.nivel === 'admin') {
        html += `
        <div id="modal" class="modal">
          <form class="modal-content" id="formNovoCliente" method="POST" action="/novo-cliente">
            <h3>Novo Cliente</h3>
            <input name="nome" placeholder="Nome" required>
            <input name="device" placeholder="Device">
            <input name="valor" placeholder="Valor">
            <input name="obs" placeholder="Observações">
            <button type="submit">Adicionar</button>
            <button type="button" onclick="fecharModal()">Cancelar</button>
          </form>
        </div>`;
      }

      html += `
      <script>
        function forcarVerificacao() {
          fetch('/forcar-verificacao')
            .then(res => {
              if (res.ok) {
                location.reload();
              } else {
                alert('Erro ao verificar');
              }
            })
            .catch(err => {
              alert('Erro ao chamar API');
              console.error(err);
            });
        }
        function abrirModal() {
          document.getElementById('modal').style.display = 'block';
        }
        function fecharModal() {
          document.getElementById('modal').style.display = 'none';
        }
      </script>`;

      res.send(html);
    }
  });
});

app.get('/toggle/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  db.get('SELECT status FROM clientes WHERE id = ?', [id], (err, row) => {
    if (!row) return res.redirect('/painel');
    const novoStatus = row.status === 'pago' ? 'nao-pago' : 'pago';
    db.run('UPDATE clientes SET status = ? WHERE id = ?', [novoStatus, id], () => {
      res.redirect('/painel');
    });
  });
});

app.get('/editar-cliente/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  db.get('SELECT * FROM clientes WHERE id = ?', [id], (err, row) => {
    if (!row) return res.redirect('/painel');
    res.send(`
      <form method="post" action="/editar-cliente/${id}">
        <input name="nome" value="${row.nome}" required>
        <input name="device" value="${row.device || ''}" placeholder="Device">
        <input name="valor" value="${row.valor || ''}" placeholder="Valor">
        <input name="obs" value="${row.obs || ''}" placeholder="Observações">
        <button type="submit">Salvar</button>
      </form>
      <a href="/painel">Cancelar</a>
    `);
  });
});

app.post('/editar-cliente/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  const { nome, device, valor, obs } = req.body;
  db.run('UPDATE clientes SET nome = ?, device = ?, valor = ?, obs = ? WHERE id = ?',
    [nome, device, valor, obs, id],
    () => res.redirect('/painel'));
});

app.post('/novo-cliente', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const { nome, device, valor, obs } = req.body;
  db.run(`INSERT INTO clientes (nome, device, valor, obs, status) VALUES (?, ?, ?, ?, ?)`,
    [nome, device, valor, obs, 'nao-pago'],
    function(err) {
      if (err) {
        console.error(err.message);
        return res.status(500).send('Erro ao adicionar cliente.');
      }
      res.redirect('/painel');
    });
});

app.get('/usuarios', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');

  db.all('SELECT * FROM usuarios', [], (err, rows) => {
    let html = `
      <link rel="stylesheet" href="/style.css">
      <div class="painel-clientes">
        <header>
          <h1>Usuários</h1>
          <div>
            <a href="/painel">Voltar</a>
            <button onclick="abrirModalUsuario()">Novo Usuário</button>
          </div>
        </header>
        <ul>`;

    rows.forEach(user => {
      html += `<li>
        ${user.nome} - ${user.nivel.toUpperCase()}
        ${user.nome !== 'admin' ? `<a href="/excluir-usuario/${user.id}">[Excluir]</a>` : ''}
      </li>`;
    });

    html += `</ul></div>

    <div id="modalUsuario" class="modal">
      <form class="modal-content" method="POST" action="/criar-usuario">
        <h3>Novo Usuário</h3>
        <input name="nome" placeholder="Nome" required>
        <input name="senha" type="password" placeholder="Senha" required>
        <select name="nivel">
          <option value="normal">Normal</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Criar</button>
        <button type="button" onclick="fecharModalUsuario()">Cancelar</button>
      </form>
    </div>

    <script>
      function abrirModalUsuario() {
        document.getElementById('modalUsuario').style.display = 'block';
      }
      function fecharModalUsuario() {
        document.getElementById('modalUsuario').style.display = 'none';
      }
    </script>`;

    res.send(html);
  });
});

app.post('/criar-usuario', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const { nome, senha, nivel } = req.body;
  db.run('INSERT INTO usuarios (nome, senha, nivel) VALUES (?, ?, ?)', [nome, senha, nivel], (err) => {
    if (err) return res.send('Erro ao criar usuário.');
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

app.get('/deletar-cliente/:id', verificarLogin, (req, res) => {
  if (req.session.nivel !== 'admin') return res.send('Acesso negado.');
  const id = req.params.id;
  db.run('DELETE FROM clientes WHERE id = ?', [id], () => {
    res.redirect('/painel');
  });
});

async function consultarPagamentosFakeBofa() {
  try {
    const res = await fetch('http://localhost:4000/transacoes');
    const transacoes = await res.json();

    transacoes.forEach(transacao => {
      db.get('SELECT * FROM clientes WHERE nome = ?', [transacao.nome], (err, row) => {
        if (row && row.status !== 'pago') {
          db.run('UPDATE clientes SET status = ? WHERE id = ?', 
            ['pago', row.id],
            () => console.log(`Atualizado: ${transacao.nome}`));
        }
      });
    });

  } catch (err) {
    console.error('Erro ao consultar Fake BofA:', err.message);
  }
}

app.get('/forcar-verificacao', verificarLogin, async (req, res) => {
  try {
    await consultarPagamentosFakeBofa();
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send('Erro ao consultar API fake.');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
