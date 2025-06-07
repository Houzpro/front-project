import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const WS_URL = 'ws://localhost:3001';
const EMOJIS = ['😀','😂','😍','😎','👍','🎉','🔥','🥳','😢','😡','🤔','🙏','💡','🚀','❤️'];

function getChatId(members) {
  return members.slice().sort().join('__');
}

function App() {
  const wsRef = useRef(null);
  const [isWsReady, setIsWsReady] = useState(false);
  const [wsError, setWsError] = useState(false);
  const [login, setLogin] = useState('');
  const [avatar, setAvatar] = useState('');
  const [user, setUser] = useState('');
  const [profile, setProfile] = useState({ name: '', avatar: '' });
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState({});
  const [input, setInput] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupAvatar, setGroupAvatar] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [showEmojis, setShowEmojis] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [showUserCard, setShowUserCard] = useState(null); // {name, avatar}
  const [editGroupModal, setEditGroupModal] = useState(null); // null или объект чата
  const [groupMenu, setGroupMenu] = useState({ open: false, anchor: null, chat: null }); // Новое состояние для меню группы
  const messagesEndRef = useRef(null);

  // Connect WebSocket only once
  useEffect(() => {
    const socket = new window.WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      setIsWsReady(true);
      setWsError(false);
    };

    socket.onerror = () => {
      setWsError(true);
      setIsWsReady(false);
    };

    socket.onclose = () => {
      setIsWsReady(false);
      setWsError(true);
    };

    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === 'login') {
        if (data.success) {
          setUser(data.user);
          setProfile(data.profile);
        } else {
          alert(data.reason || 'Ошибка входа');
        }
      }
      if (data.type === 'users') {
        setUsers(data.users);
      }
      if (data.type === 'allChats') {
        setChats(data.chats || []);
      }
      if (data.type === 'allMessages') {
        setMessages(data.messages || {});
      }
      if (data.type === 'message') {
        setMessages(prev => {
          const { chatId, msg } = data;
          const arr = prev[chatId] ? [...prev[chatId], msg] : [msg];
          return { ...prev, [chatId]: arr };
        });
      }
    };

    return () => socket.close();
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedChat]);

  // Logout on unload
  useEffect(() => {
    if (!wsRef.current || !user) return;
    const handleUnload = () => {
      try {
        wsRef.current.send(JSON.stringify({ type: 'logout' }));
      } catch {}
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [user]);

  // Автоматически выбрать первый чат после логина или создания чата
  useEffect(() => {
    // Если выбранный чат уже есть в списке чатов — не сбрасывать выбор
    if (selectedChat && chats.find(c => c.id === selectedChat.id)) {
      return;
    }
    if (chats.length > 0) {
      setSelectedChat(chats[0]);
    }
  }, [chats]); // убираем selectedChat из зависимостей

  // Личный чат с пользователем
  function getOrCreatePrivateChat(otherUser) {
    let chat = chats.find(
      c => !c.isGroup && c.members.includes(user) && c.members.includes(otherUser)
    );
    if (!chat) {
      const id = getChatId([user, otherUser]);
      chat = { id, name: otherUser, members: [user, otherUser], isGroup: false };
      setChats(prev => [...prev, chat]);
    }
    return chat;
  }

  // Получить аватар пользователя по имени
  function getAvatar(name) {
    if (name === user) return profile.avatar;
    const u = users.find(u => u.name === name);
    return u && u.avatar ? u.avatar : '';
  }

  // Сохранять тему в localStorage
  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Голосовые сообщения (hooks должны быть до любых return!)
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  // Состояние для показа кнопки удаления сообщения (должно быть здесь, а не после return!)
  const [showDeleteIdx, setShowDeleteIdx] = useState(null);
  const [showTranscribeIdx, setShowTranscribeIdx] = useState(null);
  const [transcriptions, setTranscriptions] = useState({}); // {chatId: {msgIdx: text}}

  // Функция для начала записи голосового сообщения
  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Ваш браузер не поддерживает запись аудио');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new window.MediaRecorder(stream);

      // Сбросить audioChunks при старте записи
      let localChunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          localChunks.push(e.data);
        }
      };
      recorder.onstop = () => {
        // Используем локальный массив, а не состояние
        if (localChunks.length > 0) {
          const blob = new Blob(localChunks, { type: 'audio/webm' });
          sendVoiceMessage(blob);
        }
      };

      setMediaRecorder(recorder);
      setAudioChunks([]); // для совместимости, но не используем
      recorder.start();
      setIsRecording(true);
    } catch (e) {
      alert('Ошибка доступа к микрофону');
    }
  };

  // Функция для остановки записи
  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  // Функция для отправки голосового сообщения
  const sendVoiceMessage = (blob) => {
    if (!selectedChat || !wsRef.current || !isWsReady) return;
    const reader = new FileReader();
    reader.onload = () => {
      wsRef.current.send(
        JSON.stringify({
          type: 'voice',
          chatId: selectedChat.id,
          from: user,
          audio: reader.result, // base64
          time: Date.now(),
        })
      );
    };
    reader.readAsDataURL(blob);
  };

  // Обработка входящих голосовых сообщений
  useEffect(() => {
    if (!wsRef.current) return;
    const socket = wsRef.current;
    const oldOnMessage = socket.onmessage;
    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        if (oldOnMessage) oldOnMessage(event);
        return;
      }
      if (data.type === 'voice') {
        // Исправление: поддержка разных форматов сообщений от сервера
        // Если сервер присылает {type: 'voice', chatId, msg}, используем msg
        // Если сервер присылает {type: 'voice', chatId, from, audio, ...}, собираем msg вручную
        let msg;
        if (data.msg) {
          msg = data.msg;
        } else {
          msg = {
            from: data.from,
            audio: data.audio,
            time: data.time || Date.now(),
            // можно добавить другие поля, если сервер их присылает
          };
        }
        setMessages((prev) => {
          const arr = prev[data.chatId] ? [...prev[data.chatId], msg] : [msg];
          return { ...prev, [data.chatId]: arr };
        });
        return;
      }
      // Добавьте обработку удаления сообщения
      if (data.type === 'deleteMessage') {
        setMessages((prev) => {
          const msgs = prev[data.chatId] || [];
          if (typeof data.msgIdx !== 'number') return prev;
          const msg = msgs[data.msgIdx];
          // Удалять только если сообщение действительно существует и принадлежит пользователю
          if (!msg || msg.from !== data.user) return prev;
          const newMsgs = [...msgs];
          newMsgs.splice(data.msgIdx, 1);
          return { ...prev, [data.chatId]: newMsgs };
        });
        return;
      }
      if (oldOnMessage) oldOnMessage(event);
    };
    return () => {
      socket.onmessage = oldOnMessage;
    };
    // eslint-disable-next-line
  }, [wsRef.current]);

  // Функция для расшифровки голосового сообщения
  const transcribeVoice = async (msg, idx) => {
    setTranscriptions(prev => ({
      ...prev,
      [selectedChat.id]: { ...(prev[selectedChat.id] || {}), [idx]: '⏳ Расшифровка...' }
    }));
    // Имитация задержки и "распознавания"
    setTimeout(() => {
      setTranscriptions(prev => ({
        ...prev,
        [selectedChat.id]: {
          ...(prev[selectedChat.id] || {}),
          [idx]: 'Текст голосового сообщения (пример)'
        }
      }));
    }, 1500);
  };

  if (wsError) {
    return (
      <div className="LoginScreen">
        <div className="LoginBox">
          <h2>Нет соединения с сервером</h2>
          <div style={{ color: '#888', marginTop: 8, fontSize: 15 }}>
            Проверьте, что сервер запущен на <b>{WS_URL}</b>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="LoginScreen">
        <div className="LoginBox">
          <h2>Вход в чат</h2>
          <input
            className="ChatInput"
            placeholder="Имя пользователя"
            value={login}
            onChange={e => setLogin(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && wsRef.current && isWsReady) {
                wsRef.current.send(JSON.stringify({ type: 'login', user: login.trim(), avatar: avatar.trim() }));
              }
            }}
            autoFocus
            disabled={!isWsReady}
          />
          <input
            className="ChatInput"
            placeholder="Ссылка на аватар (необязательно)"
            value={avatar}
            onChange={e => setAvatar(e.target.value)}
            style={{ marginTop: 8 }}
            disabled={!isWsReady}
          />
          <button
            className="ChatSendBtn"
            onClick={() => {
              if (wsRef.current && isWsReady) wsRef.current.send(JSON.stringify({ type: 'login', user: login.trim(), avatar: avatar.trim() }));
            }}
            disabled={!isWsReady}
          >
            Войти
          </button>
          <div style={{ color: '#888', marginTop: 8, fontSize: 13 }}>
            Имя должно быть уникальным и не пустым
          </div>
          {!isWsReady && (
            <div style={{ color: '#e57373', marginTop: 8, fontSize: 13 }}>
              Ожидание соединения с сервером...
            </div>
          )}
        </div>
      </div>
    );
  }

  // Список чатов, где состоит пользователь
  const myChats = chats.filter(c => c.members.includes(user));
  // Список других пользователей (для создания чата)
  const otherUsers = users.filter(u => u.name !== user);

  // Единый список: групповые чаты + все пользователи (кроме себя), а групповые чаты — отдельно сверху
  const unifiedList = [
    ...myChats.filter(c => c.isGroup),
    ...users.filter(u => u.name !== user)
  ];

  // Сообщения для выбранного чата
  const chatMessages = selectedChat && messages[selectedChat.id] ? messages[selectedChat.id] : [];

  // Отправка сообщения
  const sendMessage = () => {
    if (!input.trim() || !selectedChat || !wsRef.current || !isWsReady) return;
    wsRef.current.send(JSON.stringify({
      type: 'message',
      chatId: selectedChat.id,
      from: user,
      text: input,
    }));
    setInput('');
    setShowEmojis(false);
  };

  // Обновить профиль
  const saveProfile = () => {
    if (wsRef.current && isWsReady) {
      wsRef.current.send(JSON.stringify({ type: 'updateProfile', name: profile.name, avatar: profile.avatar }));
      setShowProfile(false);
    }
  };

  // Создать групповой чат
  const createGroup = () => {
    if (!groupName.trim() || groupMembers.length < 2) return;
    if (wsRef.current && isWsReady) {
      wsRef.current.send(JSON.stringify({
        type: 'createGroup',
        name: groupName,
        members: [user, ...groupMembers],
        avatar: groupAvatar,
      }));
      setShowGroupModal(false);
      setGroupName('');
      setGroupAvatar('');
      setGroupMembers([]);
    }
  };

  // Вставить смайлик
  const insertEmoji = emoji => setInput(input + emoji);

  // Загрузка аватарки в профиль
  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfile((p) => ({ ...p, avatar: ev.target.result }));
    };
    reader.readAsDataURL(file);
  };

  // При вводе ссылки на аватар очищать файл (и наоборот)
  const handleAvatarUrlChange = (e) => {
    setProfile((p) => ({ ...p, avatar: e.target.value }));
  };

  // Заглушка для аватара
  const avatarFallback = "https://ui-avatars.com/api/?background=random&name=";

  // Открыть карточку пользователя
  const handleUserClick = (u) => {
    setShowUserCard(u);
  };

  // Перейти в личный чат с пользователем из карточки
  const handleMessageUser = (u) => {
    setSelectedChat(getOrCreatePrivateChat(u.name));
    setShowUserCard(null);
  };

  // Открыть модальное окно редактирования группы
  const openEditGroup = (groupChat) => {
    setEditGroupModal({
      id: groupChat.id,
      name: groupChat.name,
      avatar: groupChat.avatar || '',
      members: groupChat.members.filter(n => n !== user), // кроме себя
      origMembers: groupChat.members.slice(),
    });
  };

  // Сохранить изменения группы
  const saveEditGroup = () => {
    if (!editGroupModal) return;
    if (!editGroupModal.name.trim() || editGroupModal.members.length < 1) return;
    if (wsRef.current && isWsReady) {
      wsRef.current.send(JSON.stringify({
        type: 'editGroup',
        id: editGroupModal.id,
        name: editGroupModal.name,
        avatar: editGroupModal.avatar,
        members: [user, ...editGroupModal.members], // всегда включаем себя
      }));
      setEditGroupModal(null);
    }
  };

  // Открыть меню группы
  const openGroupMenu = (e, chat) => {
    e.stopPropagation();
    setGroupMenu({ open: true, anchor: { x: e.clientX, y: e.clientY }, chat });
  };

  // Открыть меню группы в ChatHeader
  const openGroupMenuHeader = (e, chat) => {
    e.stopPropagation();
    setGroupMenu({ open: true, anchor: { x: e.clientX, y: e.clientY }, chat });
  };

  // Открыть модальное окно редактирования группы из меню
  const handleEditGroup = () => {
    const groupChat = groupMenu.chat;
    setEditGroupModal({
      id: groupChat.id,
      name: groupChat.name,
      avatar: groupChat.avatar || '',
      members: groupChat.members.filter(n => n !== user), // кроме себя
      origMembers: groupChat.members.slice(),
    });
    setGroupMenu({ open: false, anchor: null, chat: null });
  };

  // Добавьте функцию для удаления сообщения
  const deleteMessage = (msgIdx) => {
    if (!selectedChat || !wsRef.current || !isWsReady) return;
    // Отправить на сервер команду удалить сообщение (если сервер поддерживает)
    wsRef.current.send(
      JSON.stringify({
        type: 'deleteMessage',
        chatId: selectedChat.id,
        msgIdx,
        user,
      })
    );
    // Локально удаляем сообщение только если оно отправлено текущим пользователем
    setMessages(prev => {
      const chatMsgs = prev[selectedChat.id] || [];
      const msg = chatMsgs[msgIdx];
      if (!msg || msg.from !== user) return prev;
      const newMsgs = [...chatMsgs];
      newMsgs.splice(msgIdx, 1);
      return { ...prev, [selectedChat.id]: newMsgs };
    });
  };

  return (
    <div className={`ChatLayout ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      <div className="UsersPanel">
        <div className="UsersHeader">
          Чаты
          <button className="ChatSendBtn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 14 }}
            onClick={() => setShowGroupModal(true)}
          >+</button>
          <button className="ChatSendBtn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 14 }}
            onClick={() => setShowProfile(true)}
          >Профиль</button>
          <button
            className="ChatSendBtn"
            style={{ marginLeft: 8, padding: '2px 8px', fontSize: 14 }}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            {theme === 'dark' ? '🌞' : '🌙'}
          </button>
        </div>
        <div className="UsersList">
          {unifiedList.length === 0 && (
            <div className="UserItem user-empty">Нет чатов и пользователей</div>
          )}
          {unifiedList.map(item => {
            if (item.isGroup) {
              // Групповой чат
              return (
                <div
                  key={item.id}
                  className={`UserItem${selectedChat && selectedChat.id === item.id ? ' selected' : ''}`}
                  onClick={() => setSelectedChat(item)}
                  style={{ position: 'relative' }}
                >
                  {/* Только аватар и имя, без меню */}
                  {item.avatar && <img src={item.avatar} alt="" style={{ width: 24, height: 24, borderRadius: '50%', marginRight: 8 }} />}
                  {item.name}
                  <span style={{ color: '#bbb', fontSize: 12, marginLeft: 6 }}>👥</span>
                </div>
              );
            } else {
              // Пользователь (личный чат)
              return (
                <div
                  key={item.name}
                  className={`UserItem${selectedChat && !selectedChat.isGroup && selectedChat.members && selectedChat.members.includes(item.name) ? ' selected' : ''}`}
                  onClick={() => setSelectedChat(getOrCreatePrivateChat(item.name))}
                >
                  {item.avatar && <img src={item.avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', marginRight: 8 }} />}
                  <span className="UserNameLink" style={{ cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }}>
                    {item.name}
                  </span>
                </div>
              );
            }
          })}
        </div>
        <div className="CurrentUser">
          {profile.avatar && <img src={profile.avatar} alt="" style={{ width: 24, height: 24, borderRadius: '50%', marginRight: 8 }} />}
          Вы: <b>{user}</b>
        </div>
      </div>
      <div className="ChatPanel">
        <div className="ChatHeader">
          {selectedChat
            ? (selectedChat.isGroup
                ? (
                  <span
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                    onClick={e => openGroupMenuHeader(e, selectedChat)}
                  >
                    {selectedChat.avatar && <img src={selectedChat.avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', marginRight: 8 }} />}
                    {selectedChat.name}
                    <span style={{ color: '#bbb', fontSize: 13, marginLeft: 8 }}>({selectedChat.members.length} чел.)</span>
                  </span>
                )
                : selectedChat.members.find(n => n !== user))
            : 'Выберите чат'}
        </div>
        <div className="ChatMessages">
          {selectedChat ? (
            chatMessages.length === 0 ? (
              <div className="ChatMessage system">Нет сообщений</div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`ChatMessage ${msg.from === user ? 'me' : 'other'}`}
                  onClick={() => {
                    if (msg.from === user) setShowDeleteIdx(idx);
                    else setShowDeleteIdx(null);
                    // Показывать кнопку расшифровки для голосовых сообщений всем
                    if ('audio' in msg) setShowTranscribeIdx(idx);
                    else setShowTranscribeIdx(null);
                  }}
                  onMouseLeave={() => {
                    if (showDeleteIdx === idx) setShowDeleteIdx(null);
                    if (showTranscribeIdx === idx) setShowTranscribeIdx(null);
                  }}
                  style={{ position: 'relative', cursor: msg.from === user || 'audio' in msg ? 'pointer' : undefined }}
                >
                  {/* Аватарка отправителя */}
                  {getAvatar(msg.from) && (getAvatar(msg.from).startsWith('data:') || getAvatar(msg.from).trim().startsWith('http')) && (
                    <img
                      src={getAvatar(msg.from).trim()}
                      alt=""
                      className="MsgAvatar"
                      onError={e => { e.target.onerror = null; e.target.src = avatarFallback + encodeURIComponent(msg.from); }}
                    />
                  )}
                  {/* Имя отправителя: в группах — ссылка, в личных — просто текст */}
                  {selectedChat.isGroup ? (
                    <span
                      className="ChatAuthor UserNameLink"
                      style={{ cursor: 'pointer', textDecoration: 'underline', color: 'inherit' }}
                      onClick={() => {
                        if (msg.from !== user) {
                          const u = users.find(u => u.name === msg.from);
                          if (u) setShowUserCard(u);
                        }
                      }}
                    >
                      {msg.from === user ? 'Вы' : msg.from}:
                    </span>
                  ) : (
                    <span className="ChatAuthor">
                      {msg.from === user ? 'Вы' : msg.from}:
                    </span>
                  )}
                  {msg.text}
                  {'audio' in msg && (
                    <>
                      <audio controls src={msg.audio} style={{ verticalAlign: 'middle', marginLeft: 8, maxWidth: 180 }} />
                      {/* Кнопка расшифровки для всех, только при клике на сообщение */}
                      {showTranscribeIdx === idx && (
                        <button
                          className="ChatSendBtn"
                          style={{
                            marginLeft: 8,
                            padding: 0,
                            width: 34,
                            height: 34,
                            minWidth: 34,
                            minHeight: 34,
                            borderRadius: '50%',
                            background: '#90caf9',
                            color: '#1976d2',
                            position: 'absolute',
                            right: 54,
                            bottom: 10,
                            zIndex: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 20,
                            boxShadow: '0 2px 8px #90caf944'
                          }}
                          title="Расшифровать голосовое"
                          onClick={e => {
                            e.stopPropagation();
                            transcribeVoice(msg, idx);
                          }}
                          disabled={!!(transcriptions[selectedChat.id] && transcriptions[selectedChat.id][idx])}
                        >
                          <span role="img" aria-label="transcribe">🗣️</span>
                        </button>
                      )}
                      {/* Показывать результат расшифровки */}
                      {transcriptions[selectedChat.id] && transcriptions[selectedChat.id][idx] && (
                        <div style={{
                          marginTop: 8,
                          background: '#f8fafd',
                          color: '#1976d2',
                          borderRadius: 8,
                          padding: '6px 12px',
                          fontSize: '1em',
                          maxWidth: 320,
                          wordBreak: 'break-word'
                        }}>
                          {transcriptions[selectedChat.id][idx]}
                        </div>
                      )}
                    </>
                  )}
                  {/* Кнопка удаления только для своих сообщений и только при клике */}
                  {msg.from === user && showDeleteIdx === idx && (
                    <button
                      className="ChatSendBtn"
                      style={{
                        marginLeft: 8,
                        padding: '2px 10px',
                        fontSize: 13,
                        background: '#e57373',
                        color: '#fff',
                        position: 'absolute',
                        right: 10,
                        bottom: 10,
                        zIndex: 2,
                      }}
                      title="Удалить сообщение"
                      onClick={e => {
                        e.stopPropagation();
                        deleteMessage(idx);
                        setShowDeleteIdx(null);
                      }}
                    >
                      🗑️
                    </button>
                  )}
                  <span className="ChatTime">
                    {msg.time
                      ? new Date(msg.time).toLocaleTimeString().slice(0, 5)
                      : ''}
                  </span>
                </div>
              ))
            )
          ) : (
            <div className="ChatMessage system">
              Выберите чат
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="ChatInputBar">
          {/* Смайлики слева */}
          <button
            className="ChatSendBtn"
            style={{
              marginRight: 4,
              fontSize: 18,
              padding: '0 8px',
            }}
            onClick={() => setShowEmojis(e => !e)}
            tabIndex={-1}
          >😊</button>
          {showEmojis && (
            <div className="EmojiPanel">
              {EMOJIS.map(e => (
                <span key={e} className="EmojiBtn" onClick={() => insertEmoji(e)}>{e}</span>
              ))}
            </div>
          )}
          <input
            className="ChatInput"
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') sendMessage();
            }}
            placeholder={
              selectedChat ? 'Введите сообщение...' : 'Выберите чат...'
            }
            disabled={!selectedChat}
          />
          {/* Кнопка микрофона теперь справа перед отправкой */}
          <button
            className="ChatSendBtn"
            style={{
              marginRight: 4,
              fontSize: 18,
              padding: '0 8px',
              background: isRecording ? '#e57373' : undefined,
              color: isRecording ? '#fff' : undefined,
            }}
            onClick={() => {
              if (!isRecording) startRecording();
              else stopRecording();
            }}
            title={isRecording ? 'Остановить запись' : 'Записать голосовое сообщение'}
            tabIndex={-1}
          >
            {isRecording ? '⏹️' : '🎤'}
          </button>
          <button
            className="ChatSendBtn"
            onClick={sendMessage}
            disabled={!selectedChat || !input.trim()}
          >
            Отправить
          </button>
        </div>
      </div>

      {/* Модальное окно профиля */}
      {showProfile && (
        <div className="ModalOverlay" onClick={() => setShowProfile(false)}>
          <div className="ModalBox" onClick={e => e.stopPropagation()}>
            <h3>Профиль</h3>
            <input
              className="ChatInput"
              value={profile.name}
              onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
              disabled
              style={{ marginBottom: 8 }}
            />
            <input
              className="ChatInput"
              placeholder="Ссылка на аватар"
              value={profile.avatar}
              onChange={handleAvatarUrlChange}
              style={{ marginBottom: 8 }}
            />
            <label className="AvatarUploadBtn">
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarUpload}
              />
              Загрузить аватар
            </label>
            {/* Показывать картинку только если это base64 или ссылка начинается с http */}
            {profile.avatar && (profile.avatar.startsWith('data:') || profile.avatar.trim().startsWith('http')) && (
              <img
                src={profile.avatar.trim()}
                alt=""
                style={{ width: 64, height: 64, borderRadius: '50%', margin: '12px 0' }}
                onError={e => { e.target.onerror = null; e.target.src = avatarFallback + encodeURIComponent(profile.name || user); }}
              />
            )}
            <button className="ChatSendBtn" onClick={saveProfile}>Сохранить</button>
          </div>
        </div>
      )}

      {/* Модальное окно создания группы */}
      {showGroupModal && (
        <div className="ModalOverlay" onClick={() => setShowGroupModal(false)}>
          <div className="ModalBox" onClick={e => e.stopPropagation()}>
            <h3>Создать групповой чат</h3>
            <input
              className="ChatInput"
              placeholder="Название группы"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <input
              className="ChatInput"
              placeholder="Ссылка на аватар группы (необязательно)"
              value={groupAvatar}
              onChange={e => setGroupAvatar(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>Участники:</div>
              {otherUsers.map(u => (
                <label key={u.name} style={{ display: 'block', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={groupMembers.includes(u.name)}
                    onChange={e => {
                      setGroupMembers(members =>
                        e.target.checked
                          ? [...members, u.name]
                          : members.filter(n => n !== u.name)
                      );
                    }}
                  />{' '}
                  {u.avatar && <img src={u.avatar} alt="" style={{ width: 18, height: 18, borderRadius: '50%', marginRight: 4 }} />}
                  {u.name}
                </label>
              ))}
            </div>
            <button className="ChatSendBtn" onClick={createGroup} disabled={!groupName.trim() || groupMembers.length < 2}>
              Создать
            </button>
          </div>
        </div>
      )}

      {/* Меню группы (теперь открывается только из ChatHeader) */}
      {groupMenu.open && (
        <div
          style={{
            position: 'fixed',
            left: groupMenu.anchor.x,
            top: groupMenu.anchor.y,
            zIndex: 2000,
            background: theme === 'dark' ? '#23272f' : '#fff',
            border: '1px solid #e3e6ea',
            borderRadius: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            minWidth: 180,
            padding: 0
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className="ChatSendBtn"
            style={{
              width: '100%',
              borderRadius: 0,
              background: 'none',
              color: theme === 'dark' ? '#90caf9' : '#1976d2',
              border: 'none',
              textAlign: 'left',
              padding: '12px 18px',
              fontWeight: 500,
              fontSize: 15,
              cursor: 'pointer'
            }}
            onClick={handleEditGroup}
          >
            Редактировать группу
          </button>
          <button
            className="ChatSendBtn"
            style={{
              width: '100%',
              borderRadius: 0,
              background: 'none',
              color: '#888',
              border: 'none',
              textAlign: 'left',
              padding: '12px 18px',
              fontWeight: 400,
              fontSize: 15,
              cursor: 'pointer'
            }}
            onClick={() => setGroupMenu({ open: false, anchor: null, chat: null })}
          >
            Закрыть
          </button>
        </div>
      )}

      {/* Модальное окно редактирования группы */}
      {editGroupModal && (
        <div className="ModalOverlay" onClick={() => setEditGroupModal(null)}>
          <div className="ModalBox" onClick={e => e.stopPropagation()}>
            <h3>Редактировать группу</h3>
            <input
              className="ChatInput"
              placeholder="Название группы"
              value={editGroupModal.name}
              onChange={e => setEditGroupModal(modal => ({ ...modal, name: e.target.value }))}
              style={{ marginBottom: 8 }}
            />
            <input
              className="ChatInput"
              placeholder="Ссылка на аватар группы (необязательно)"
              value={editGroupModal.avatar}
              onChange={e => setEditGroupModal(modal => ({ ...modal, avatar: e.target.value }))}
              style={{ marginBottom: 8 }}
            />
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>Участники (кроме вас):</div>
              {users.filter(u => u.name !== user).map(u => (
                <label key={u.name} style={{ display: 'block', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={editGroupModal.members.includes(u.name)}
                    onChange={e => {
                      setEditGroupModal(modal => ({
                        ...modal,
                        members: e.target.checked
                          ? [...modal.members, u.name]
                          : modal.members.filter(n => n !== u.name)
                      }));
                    }}
                  />{' '}
                  {u.avatar && <img src={u.avatar} alt="" style={{ width: 18, height: 18, borderRadius: '50%', marginRight: 4 }} />}
                  {u.name}
                </label>
              ))}
            </div>
            <button
              className="ChatSendBtn"
              onClick={saveEditGroup}
              disabled={!editGroupModal.name.trim() || editGroupModal.members.length < 1}
            >
              Сохранить изменения
            </button>
            <button
              className="ChatSendBtn"
              style={{ marginTop: 8, background: '#eee', color: '#222' }}
              onClick={() => setEditGroupModal(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Модальное окно карточки пользователя только для UsersList */}
      {showUserCard && (
        <div className="ModalOverlay" onClick={() => setShowUserCard(null)}>
          <div className="ModalBox UserCardBox" onClick={e => e.stopPropagation()}>
            {showUserCard.avatar && (showUserCard.avatar.startsWith('data:') || showUserCard.avatar.trim().startsWith('http')) && (
              <img src={showUserCard.avatar.trim()} alt="" style={{ width: 72, height: 72, borderRadius: '50%', marginBottom: 12 }} onError={e => { e.target.onerror = null; e.target.src = avatarFallback + encodeURIComponent(showUserCard.name); }} />
            )}
            <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 8 }}>{showUserCard.name}</div>
            <button
              className="ChatSendBtn"
              onClick={() => { setSelectedChat(getOrCreatePrivateChat(showUserCard.name)); setShowUserCard(null); }}
              style={{ marginTop: 8 }}
            >
              Написать сообщение
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
