const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SEED_ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ACCOUNTS_FILE = path.join(os.tmpdir(), 'r2-lucky9-games-accounts.json');
const PORT = process.env.PORT || 3100;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const DEFAULT_ACCOUNTS = {
  admin: {
    username: 'admin',
    name: 'System Administrator',
    email: 'admin@system.com',
    password: 'pbkdf2$120000$2XNgwntuJZcWoUj3o9W8cg$BWEuKPwR2cCnoXY-2bQ3TgNp3_OvNL_8yZEnvS55Hbc',
    role: 'Developer',
    permissions: ['inventory'],
    office: '',
    inventoryAccess: ['Rizal', 'Cebu', 'Thermal'],
    disabled: false
  },
};

async function ensureAccountsFile() {
  try {
    await fs.access(ACCOUNTS_FILE);
  } catch (error) {
    let seedAccounts = DEFAULT_ACCOUNTS;

    try {
      seedAccounts = JSON.parse(await fs.readFile(SEED_ACCOUNTS_FILE, 'utf8'));
    } catch (seedError) {
      // Use built-in accounts when the seed file is unavailable.
    }

    await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(seedAccounts, null, 2), 'utf8');
  }
}

async function loadAccounts() {
  await ensureAccountsFile();
  const content = await fs.readFile(ACCOUNTS_FILE, 'utf8');
  return JSON.parse(content || '{}');
}

async function saveAccounts(accounts) {
  await ensureAccountsFile();
  await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}

function sanitizeAccount(account) {
  return {
    username: account.username,
    name: account.name,
    email: account.email,
    role: account.role,
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
    office: account.office || '',
    inventoryAccess: Array.isArray(account.inventoryAccess) ? account.inventoryAccess : [],
    disabled: Boolean(account.disabled)
  };
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function verifyPassword(password, storedPassword) {
  if (!String(storedPassword || '').startsWith('pbkdf2$')) {
    return storedPassword === password;
  }

  const [, iterationText, saltText, hashText] = storedPassword.split('$');
  const derived = crypto.pbkdf2Sync(password, Buffer.from(saltText, 'base64url'), Number(iterationText), 32, 'sha256');
  const expected = Buffer.from(hashText, 'base64url');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function hashPassword(password) {
  const iterations = 120000;
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function handleApiLogin(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  let body = '';
  request.on('data', chunk => {
    body += chunk;
  });

  request.on('end', async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const usernameOrEmail = String(payload.usernameOrEmail || '').trim();
      const password = String(payload.password || '');

      if (!usernameOrEmail || !password) {
        sendJson(response, 400, { ok: false, message: 'Username and password are required.' });
        return;
      }

      const accounts = await loadAccounts();
      const normalizedInput = usernameOrEmail.toLowerCase();
      const matchedKey = Object.keys(accounts).find((key) => {
        const account = accounts[key];
        return account && (
          account.username.toLowerCase() === normalizedInput ||
          account.email.toLowerCase() === normalizedInput
        );
      });

      if (!matchedKey) {
        sendJson(response, 401, { ok: false, message: 'Invalid credentials.' });
        return;
      }

      const account = accounts[matchedKey];

      if (account.disabled) {
        sendJson(response, 403, { ok: false, message: 'This account has been disabled.' });
        return;
      }

      if (!verifyPassword(password, account.password)) {
        sendJson(response, 401, { ok: false, message: 'Invalid credentials.' });
        return;
      }

      const safeAccounts = {};
      Object.keys(accounts).forEach((key) => {
        safeAccounts[key] = sanitizeAccount(accounts[key]);
      });

      sendJson(response, 200, {
        ok: true,
        account: sanitizeAccount(account),
        accounts: safeAccounts
      });
    } catch (error) {
      console.error('Login error:', error);
      sendJson(response, 500, { ok: false, message: 'Server error while processing login.' });
    }
  });
}

async function handleApiAccounts(request, response) {
  if (request.method === 'GET') {
    try {
      const accounts = await loadAccounts();
      const safeAccounts = {};
      Object.keys(accounts).forEach((key) => {
        safeAccounts[key] = sanitizeAccount(accounts[key]);
      });

      sendJson(response, 200, { ok: true, accounts: safeAccounts });
    } catch (error) {
      console.error('Accounts fetch error:', error);
      sendJson(response, 500, { ok: false, message: 'Unable to load accounts.' });
    }
    return;
  }

  if (request.method === 'DELETE') {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });

    request.on('end', async () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const username = String(payload.username || '').trim();
        const accounts = await loadAccounts();

        if (!username || !accounts[username]) {
          sendJson(response, 404, { ok: false, message: 'Account not found.' });
          return;
        }

        delete accounts[username];
        await saveAccounts(accounts);
        sendJson(response, 200, { ok: true, message: 'Account deleted successfully.' });
      } catch (error) {
        console.error('Account delete error:', error);
        sendJson(response, 500, { ok: false, message: 'Unable to delete account.' });
      }
    });
    return;
  }

  if (request.method === 'POST') {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });

    request.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const submittedAccounts = parsed && typeof parsed === 'object' ? parsed : {};
        const existingAccounts = await loadAccounts();
        const accounts = { ...existingAccounts };

        Object.keys(submittedAccounts).forEach((username) => {
          const submittedAccount = submittedAccounts[username];
          const existingAccount = existingAccounts[username];

          accounts[username] = existingAccount && submittedAccount && !submittedAccount.password
            ? { ...existingAccount, ...submittedAccount, password: existingAccount.password }
            : submittedAccount;
        });

        await saveAccounts(accounts);
        sendJson(response, 200, { ok: true, message: 'Accounts saved successfully.' });
      } catch (error) {
        console.error('Accounts save error:', error);
        sendJson(response, 500, { ok: false, message: 'Unable to save accounts.' });
      }
    });
    return;
  }

  sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
}

async function handleApiChangePassword(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  let body = '';
  request.on('data', chunk => {
    body += chunk;
  });

  request.on('end', async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const username = String(payload.username || '').trim();
      const newPassword = String(payload.newPassword || '');
      const passwordHash = String(payload.passwordHash || '');
      const accounts = await loadAccounts();
      const account = accounts[username];

      if (!account) {
        sendJson(response, 404, { ok: false, message: 'Account not found.' });
        return;
      }

      if (newPassword.length < 6) {
        sendJson(response, 400, { ok: false, message: 'New password must be at least 6 characters.' });
        return;
      }

      accounts[username] = { ...account, password: passwordHash || newPassword };
      await saveAccounts(accounts);
      sendJson(response, 200, { ok: true, account: sanitizeAccount(accounts[username]) });
    } catch (error) {
      console.error('Password change error:', error);
      sendJson(response, 500, { ok: false, message: 'Unable to change password.' });
    }
  });
}

async function serveStaticFile(response, filePath) {
  try {
    const resolvedPath = path.resolve(ROOT_DIR, filePath);
    const normalizedPath = resolvedPath.startsWith(ROOT_DIR) ? resolvedPath : path.join(ROOT_DIR, 'index.html');
    const fileContent = await fs.readFile(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    setCorsHeaders(response);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    response.end(fileContent);
  } catch (error) {
    setCorsHeaders(response);
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

async function main() {
  await ensureAccountsFile();

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (request.method === 'OPTIONS') {
      setCorsHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    if (pathname === '/api/login') {
      await handleApiLogin(request, response);
      return;
    }

    if (pathname === '/api/accounts') {
      await handleApiAccounts(request, response);
      return;
    }

    if (pathname === '/api/change-password') {
      await handleApiChangePassword(request, response);
      return;
    }

    if (pathname === '/api/hash-password') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
        return;
      }

      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        try {
          const password = String((body ? JSON.parse(body) : {}).password || '');
          if (password.length < 6) {
            sendJson(response, 400, { ok: false, message: 'Password must be at least 6 characters.' });
            return;
          }
          sendJson(response, 200, { ok: true, passwordHash: hashPassword(password) });
        } catch (error) {
          sendJson(response, 400, { ok: false, message: 'Invalid password request.' });
        }
      });
      return;
    }

    let filePath = pathname === '/' ? '/index.html' : pathname;
    if (filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    await serveStaticFile(response, filePath);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Shared backend login server is running on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
