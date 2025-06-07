const WebSocket = require('ws');
// Функция для сохранения данных в chat-data.json
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'chat-data.json');

let users = [];
let chats = [];
let messages = {};

function saveData() {
  const data = { users, chats, messages };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      users = data.users || [];
      chats = data.chats || [];
      messages = data.messages || {};
    } catch (e) {
      // ignore parse errors
    }
  }
}

// Загружаем данные при запуске
loadData();

// --- ВАЖНО: Не вызывайте loadData() больше нигде кроме старта сервера! ---
// Если вы вызываете loadData() внутри обработчиков WebSocket или где-либо еще — УДАЛИТЕ эти вызовы!
// Это приведет к сбросу состояния к тому, что было при запуске сервера.

const PORT = 3001;

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log('WebSocket server started on ws://localhost:' + PORT);
});

function getChatId(members) {
  return members.slice().sort().join('__');
}

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

const clients = new Map(); // name -> ws

// ВАЖНО: Не удаляйте участников из групповых чатов при отключении или потере соединения!

wss.on('connection', ws => {
  let currentUser = null;

  ws.on('message', msg => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    if (data.type === 'login') {
      if (!data.user) {
        ws.send(JSON.stringify({ type: 'login', success: false, reason: 'Имя не указано' }));
        return;
      }
      // Не удалять пользователя из чатов и users!
      // Просто закрываем старое соединение, если оно есть
      if (clients.has(data.user)) {
        try { clients.get(data.user).close(); } catch {}
        clients.delete(data.user);
      }
      // Добавить пользователя в users, если его нет
      if (!users.find(u => u.name === data.user)) {
        users.push({ name: data.user, avatar: data.avatar || '' });
        saveData();
      }
      // Обновить аватар, если изменился
      const userObj = users.find(u => u.name === data.user);
      if (userObj && data.avatar && userObj.avatar !== data.avatar) {
        userObj.avatar = data.avatar;
        saveData();
      }
      currentUser = data.user;
      clients.set(currentUser, ws);
      ws.send(JSON.stringify({ type: 'login', success: true, user: currentUser, profile: { name: currentUser, avatar: userObj ? userObj.avatar : '' } }));
      broadcast('users', { users });
      ws.send(JSON.stringify({ type: 'allChats', chats }));
      ws.send(JSON.stringify({ type: 'allMessages', messages }));
    }

    if (data.type === 'logout') {
      // Просто удаляем сокет из clients, не трогаем users/chats
      if (currentUser) {
        clients.delete(currentUser);
        // Не удаляйте пользователя из members групповых чатов!
        saveData();
      }
    }

    if (data.type === 'updateProfile') {
      const user = users.find(u => u.name === data.name);
      if (user) {
        user.avatar = data.avatar || '';
        saveData();
        broadcast('users', { users });
      }
    }

    if (data.type === 'createGroup') {
      const { name, members, avatar } = data;
      if (!name || !Array.isArray(members) || members.length < 2) return;
      // Создаем новый групповой чат с участниками
      const groupId = 'group_' + Date.now();
      const groupChat = {
        id: groupId,
        name,
        avatar: avatar || '',
        members: Array.from(new Set(members)), // сохраняем всех участников!
        isGroup: true
      };
      chats.push(groupChat);
      saveData();
      broadcast('allChats', { chats });
    }

    if (data.type === 'message') {
      const { chatId, text, from } = data;
      if (!chatId || !text || !from) return;
      const msgObj = {
        from,
        text,
        time: Date.now(),
      };
      if (!messages[chatId]) messages[chatId] = [];
      messages[chatId].push(msgObj);
      saveData();
      broadcast('message', { chatId, msg: msgObj });
    }

    if (data.type === 'editGroup') {
      // Найти группу по id
      const group = chats.find(c => c.id === data.id && c.isGroup);
      if (group) {
        group.name = data.name;
        group.avatar = data.avatar;
        group.members = Array.from(new Set(data.members)); // сохраняем всех участников!
        saveData();
        broadcast('allChats', { chats });
      }
    }

    // Голосовое сообщение
    if (data.type === 'voice') {
      // msgId генерируем на сервере
      const msg = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        from: data.from,
        audio: data.audio,
        time: Date.now(),
      };
      // Отправить всем участникам чата
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'voice',
            chatId: data.chatId,
            msg,
          }));
        }
      });
    }

    // Запрос на расшифровку голосового сообщения
    if (data.type === 'transcribeVoice') {
      // Здесь должна быть интеграция с сервисом распознавания речи (например, Yandex SpeechKit, Google Speech-to-Text и т.д.)
      // Для примера просто возвращаем "Тестовая расшифровка"
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'voiceTranscription',
          msgId: data.msgId,
          text: 'Тестовая расшифровка (demo)',
        }));
      }, 1200);
    }
  });

  ws.on('close', () => {
    if (currentUser) {
      clients.delete(currentUser);
      // НЕ удаляйте пользователя из users или members чатов!
      saveData();
    }
  });
});
