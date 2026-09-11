// config
const SUPABASE_URL  = 'https://cgbsuudnsjegwsvferbe.supabase.co';
const SUPABASE_ANON = 'sb_publishable_U-vwBs44tiha3_w-gi6sQg_6qwxH8XS';

const MAX_MSG_LENGTH = 2000;
const SEND_COOLDOWN  = 2000;
const MSG_PAGE_SIZE  = 60;

const DEFAULT_COLOR = '#968cff';
const DELETED_USER_COLOR = 'var(--textMuted)';

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
  },
});

// state
let _user         = null;
let _profile      = null;
let _realtimeSub  = null;
let _reconnTimer  = null;
let _lastSentAt   = 0;
let _replyToId    = null;
let _replyToName  = null;
let _banTargetId  = null;
let _banTargetName = null;
let _privateRecipients = [];
let _bootedUserId = null;

// boot
document.addEventListener('DOMContentLoaded', () => {
  buildSetupPalette();
  buildSidebarPalette();
  bindStaticEvents();

  _sb.auth.onAuthStateChange(async (_event, session) => {
    try {
      if (!session) {
        _user = null; _profile = null; _bootedUserId = null;
        showView('signin');
        return;
      }

      _user = session.user;

      if (_bootedUserId === _user.id) return;
      _bootedUserId = _user.id;

      _profile = await fetchProfile(_user.id);

      if (!_profile?.username) {
        showView('setup');
        return;
      }

      const pendingDeletion = await fetchPendingDeletion(_user.id);
      if (pendingDeletion) {
        showView('pendingDeletion', pendingDeletion);
        return;
      }

      const suspension = await fetchActiveSuspension(_user.id);
      if (suspension) {
        showView('banned', suspension);
        return;
      }

      showView('converse');
      renderSidebar();
      await bootconverse();
    } catch (err) {
      console.error('Initialization error:', err);
    } finally {
      await userClickPromise;
      hideAppLoader();
    }
  });
});

const userClickPromise = new Promise((resolve) => {
  document.addEventListener('DOMContentLoaded', () => {
    const cloak = document.querySelector(".img");
    const spinner = document.getElementById("loadingSpinner");
    
    if (!cloak) return resolve();

    cloak.addEventListener("click", () => {
      cloak.classList.add("hidden");
      if (spinner) spinner.classList.remove("spinner-hidden");
      resolve();
    }, { once: true });
  });
});

// view switching
function showView(name, data = null) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view' + name[0].toUpperCase() + name.slice(1));
  if (el) el.classList.add('active');

  if (name === 'banned' && data) renderBannedView(data);
  if (name === 'pendingDeletion' && data) renderPendingDeletionView(data);
  if (name !== 'pendingDeletion') stopDeletionCountdown();
}

// profile fetching
async function fetchProfile(uid) {
  const { data } = await _sb
    .from('profiles').select('*').eq('id', uid).maybeSingle();
  return data;
}

async function fetchActiveSuspension(uid) {
  const now = new Date().toISOString();
  const { data } = await _sb
    .from('suspensions').select('*').eq('user_id', uid)
    .or(`is_permanent.eq.true,expires_at.gt.${now}`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function fetchPendingDeletion(uid) {
  const { data } = await _sb
    .from('pending_deletions').select('*').eq('user_id', uid).maybeSingle();
  return data;
}

// generic edge function caller
async function callEdgeFunction(name, body = {}, requireAuth = false) {
  const headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON };
  if (requireAuth) {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) throw new Error('Not authenticated.');
    headers['Authorization'] = `Bearer ${session.access_token}`;
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_ANON}`;
  }
  const res  = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Request failed.');
  return data;
}

async function submitPasskeyLogin() {
  const emailInput   = document.getElementById('passkeyLoginEmail');
  const tokenInput   = document.getElementById('passkeyLoginToken');
  const errEl        = document.getElementById('passkeyLoginError');
  const submitButton = document.getElementById('passkeyLoginSubmitButton');

  const email = emailInput.value.trim();
  const token = tokenInput.value.trim();
  errEl.textContent = '';

  if (!email || !token) {
    errEl.textContent = 'Enter your email and passkey.';
    return;
  }

  submitButton.disabled  = true;
  const originalText     = submitButton.textContent;
  submitButton.textContent = 'Signing in...';

  try {
    const data = await callEdgeFunction('passkey-login', { email, token }, false);
    const { error: verifyError } = await _sb.auth.verifyOtp({
      token_hash: data.token_hash,
      type: 'email',
    });

    if (verifyError) {
      errEl.textContent = 'Login failed. Please try again.';
    }
  } catch (err) {
    errEl.textContent = err.message || 'Invalid email or passkey.';
  } finally {
    submitButton.disabled    = false;
    submitButton.textContent = originalText;
  }
}

async function loadPasskeyStatus() {
  const toggle       = document.getElementById('passkeyEnabledToggle');
  const statusText   = document.getElementById('passkeyStatusText');
  const resetButton  = document.getElementById('passkeyResetButton');
  if (!toggle) return;

  try {
    const data = await callEdgeFunction('passkey-status', {}, true);
    toggle.checked = !!data.enabled;
    resetButton.style.display = data.enabled ? 'inline-block' : 'none';
    statusText.textContent = data.enabled
      ? 'Passkey login is on.'
      : (data.hasPasskey ? 'Passkey login is off.' : 'No passkey generated yet.');
  } catch (err) {
    console.error('Failed to load passkey status:', err);
  }
}

async function handlePasskeyToggleChange(e) {
  const toggle       = e.target;
  const wantEnabled  = toggle.checked;
  const resetButton  = document.getElementById('passkeyResetButton');
  toggle.disabled    = true;

  if (!wantEnabled) resetButton.style.display = 'none';

  try {
    if (!wantEnabled) {
      await callEdgeFunction('passkey-toggle', { enabled: false }, true);
      await loadPasskeyStatus();
      return;
    }

    const data = await callEdgeFunction('passkey-toggle', { enabled: true }, true);
    if (data.needsGenerate) {
      await generatePasskey();
    } else {
      await loadPasskeyStatus();
    }
  } catch (err) {
    console.error('Passkey toggle error:', err);
    toggle.checked = !wantEnabled;
    await loadPasskeyStatus();
  } finally {
    toggle.disabled = false;
  }
}

async function generatePasskey() {
  try {
    const data = await callEdgeFunction('passkey-generate', {}, true);
    showPasskeyToken(data.token);
  } catch (err) {
    console.error('Passkey generate error:', err);
    alert('Failed to generate passkey. Please try again.');
  } finally {
    await loadPasskeyStatus();
  }
}

function showPasskeyToken(token) {
  document.getElementById('passkeyTokenValue').textContent = token;
  document.getElementById('passkeyTokenModal').classList.add('active');
}

function closePasskeyModal() {
  document.getElementById('passkeyTokenModal').classList.remove('active');
  document.getElementById('passkeyTokenValue').textContent = '';
}

function copyPasskeyToken() {
  const text = document.getElementById('passkeyTokenValue').textContent;
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

// sign in
function signInWith(provider) {
  _sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + '/converse.html' },
  });
}

// username setup
let _setupColor = DEFAULT_COLOR;
let _usernameCheckTimer = null;

function buildSetupPalette() {
  const container = document.getElementById('setupColorPalette');
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'colorPickerWrap';

  const picker = document.createElement('input');
  picker.type       = 'color';
  picker.className  = 'colorPickerInput';
  picker.id         = 'setupColorInput';
  picker.value      = _setupColor;

  const hexLabel = document.createElement('span');
  hexLabel.className   = 'colorPickerHex';
  hexLabel.textContent = _setupColor;

  picker.addEventListener('input', () => {
    _setupColor          = picker.value;
    hexLabel.textContent = picker.value;
  });

  wrap.appendChild(picker);
  wrap.appendChild(hexLabel);
  container.appendChild(wrap);
}

function checkUsernameInput(val, statusEl, errorEl, submitButton) {
  clearTimeout(_usernameCheckTimer);
  submitButton.disabled   = true;
  errorEl.textContent  = '';
  statusEl.textContent = '';
  statusEl.className   = 'inputStatus';

  if (!val) return;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(val)) {
    statusEl.textContent = '✗';
    statusEl.className   = 'inputStatus err';
    errorEl.textContent  = '3-20 chars, letters/numbers/underscores only.';
    return;
  }

  if ((val.match(/_/g) || []).length > 1) {
    statusEl.textContent = '✗';
    statusEl.className   = 'inputStatus err';
    errorEl.textContent  = 'Only one underscore allowed.';
    return;
  }

  statusEl.textContent = '…';
  statusEl.className   = 'inputStatus checking';

  _usernameCheckTimer = setTimeout(async () => {
    const { data } = await _sb
      .from('profiles').select('id').ilike('username', val).maybeSingle();
    if (data) {
      statusEl.textContent = '✗'; statusEl.className = 'inputStatus err';
      errorEl.textContent  = 'Username already taken.';
    } else {
      statusEl.textContent = '✓'; statusEl.className = 'inputStatus ok';
      submitButton.disabled   = false;
    }
  }, 500);
}

async function submitSetup() {
  const Button   = document.getElementById('setupSubmitButton');
  const input = document.getElementById('setupUsernameInput');
  const err   = document.getElementById('setupUsernameError');
  Button.disabled = true;

  const { error } = await _sb
    .from('profiles').update({ username: input.value.trim(), color: _setupColor })
    .eq('id', _user.id);

  if (error) {
    err.textContent = 'Failed to save. Please try again.';
    Button.disabled = false;
    return;
  }

  _profile = await fetchProfile(_user.id);
  renderSidebar();

  const suspension = await fetchActiveSuspension(_user.id);
  if (suspension) { showView('banned', suspension); return; }

  showView('converse');
  await bootconverse();
}

// banned
function renderBannedView(suspension) {
  document.getElementById('banReasonText').textContent = suspension.reason;
  const expiryEl = document.getElementById('banExpiryText');
  if (suspension.is_permanent) {
    expiryEl.textContent = 'Permanent';
  } else if (suspension.expires_at) {
    const expires = new Date(suspension.expires_at);
    const days    = Math.ceil((expires - new Date()) / 864e5);
    expiryEl.textContent =
      `${days} day${days !== 1 ? 's' : ''} remaining ` +
      `(until ${expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`;
  }
}

// pending account deletion
let _deletionCountdownTimer = null;

function stopDeletionCountdown() {
  if (_deletionCountdownTimer) {
    clearInterval(_deletionCountdownTimer);
    _deletionCountdownTimer = null;
  }
}

function renderPendingDeletionView(pendingDeletion) {
  const deleteAt = new Date(pendingDeletion.delete_at);

  document.getElementById('deletionDateText').textContent =
    deleteAt.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });

  const countdownEl = document.getElementById('deletionCountdownText');
  const updateCountdown = () => {
    const msLeft = deleteAt - new Date();
    if (msLeft <= 0) {
      countdownEl.textContent = 'Deletion is being finalized...';
      stopDeletionCountdown();
      return;
    }
    const hoursLeft = Math.floor(msLeft / 36e5);
    const days      = Math.floor(hoursLeft / 24);
    const hours     = hoursLeft % 24;
    countdownEl.textContent = days > 0
      ? `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''} remaining`
      : `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
  };

  stopDeletionCountdown();
  updateCountdown();
  _deletionCountdownTimer = setInterval(updateCountdown, 60000);
}

function openDeleteAccountModal() {
  document.getElementById('deleteAccountModal').classList.add('active');
}

function closeDeleteAccountModal() {
  document.getElementById('deleteAccountModal').classList.remove('active');
}

async function confirmDeleteAccount() {
  const confirmButton = document.getElementById('deleteAccountConfirmButton');
  confirmButton.disabled = true;
  const originalText = confirmButton.textContent;
  confirmButton.textContent = 'Deleting...';

  try {
    const data = await callEdgeFunction('account-delete-request', {}, true);
    closeDeleteAccountModal();
    showView('pendingDeletion', data);
  } catch (err) {
    console.error('Account deletion request error:', err);
    alert('Failed to schedule account deletion. Please try again.');
  } finally {
    confirmButton.disabled = false;
    confirmButton.textContent = originalText;
  }
}

async function cancelAccountDeletion() {
  const cancelButton = document.getElementById('cancelDeletionButton');
  cancelButton.disabled = true;
  const originalText = cancelButton.textContent;
  cancelButton.textContent = 'Cancelling...';

  try {
    await callEdgeFunction('account-delete-cancel', {}, true);
    location.reload();
  } catch (err) {
    console.error('Account deletion cancel error:', err);
    alert('Failed to cancel account deletion. Please try again.');
    cancelButton.disabled = false;
    cancelButton.textContent = originalText;
  }
}

// sidebar
function renderSidebar() {
  if (!_profile) return;
  const dispEl = document.getElementById('sidebarUsernameDisplay');
  dispEl.textContent  = _profile.username;
  dispEl.style.color  = _profile.color;

  buildSidebarPalette();
  renderCooldownState();
  loadPasskeyStatus();
  if (_profile.is_admin) {
    document.body.classList.add('converseAdminMode');
    document.getElementById('adminPanel').style.display = 'block';
    loadAdminBans();
    bindAdminSearch();
  } else {
    document.body.classList.remove('converseAdminMode');
  }
}

function buildSidebarPalette() {
  const container = document.getElementById('sidebarColorPalette');
  if (!container || container.dataset.built) return;
  container.dataset.built = 'true';

  const wrap = document.createElement('div');
  wrap.className = 'colorPickerWrap';

  const picker = document.createElement('input');
  picker.type      = 'color';
  picker.className = 'colorPickerInput';
  picker.id        = 'sidebarColorInput';
  picker.value     = _profile?.color || DEFAULT_COLOR;

  const hexLabel = document.createElement('span');
  hexLabel.className   = 'colorPickerHex';
  hexLabel.textContent = picker.value;

  picker.addEventListener('input', () => {
    hexLabel.textContent = picker.value;
  });
  picker.addEventListener('change', () => {
    handleColorChange(picker.value);
  });

  wrap.appendChild(picker);
  wrap.appendChild(hexLabel);
  container.appendChild(wrap);
}

function updateSidebarSwatch(hex) {
  const picker = document.getElementById('sidebarColorInput');
  const label  = document.querySelector('#sidebarColorPalette .colorPickerHex');
  if (picker) picker.value = hex;
  if (label)  label.textContent = hex;
}

async function handleColorChange(hex) {
  const prev = _profile.color;
  _profile.color = hex;
  updateSidebarSwatch(hex);
  const dispEl = document.getElementById('sidebarUsernameDisplay');
  dispEl.style.color = hex;

  const { error } = await _sb
    .from('profiles').update({ color: hex }).eq('id', _user.id);
  if (error) {
    _profile.color = prev;
    updateSidebarSwatch(prev);
    dispEl.style.color = prev;
  }
}

// username change
function canChangeUsername() {
  if (!_profile.username_changed_at) return { can: true };
  const elapsed = Date.now() - new Date(_profile.username_changed_at).getTime();
  const limit   = 90 * 864e5;
  if (elapsed >= limit) return { can: true };
  return { can: false, daysLeft: Math.ceil((limit - elapsed) / 864e5) };
}

function renderCooldownState() {
  const { can, daysLeft } = canChangeUsername();
  const cooldownEl = document.getElementById('sidebarCooldown');
  const toggleButton  = document.getElementById('toggleChangeUsernameButton');

  if (!can) {
    toggleButton.disabled           = true;
    cooldownEl.style.display     = 'block';
    cooldownEl.textContent       = `Username locked for ${daysLeft} more day${daysLeft !== 1 ? 's' : ''}.`;
  } else {
    toggleButton.disabled       = false;
    cooldownEl.style.display = 'none';
  }
}

let _changeUsernameOpen = false;
let _changeUsernameTimer = null;

function toggleChangeUsernameForm() {
  _changeUsernameOpen = !_changeUsernameOpen;
  const input      = document.getElementById('changeUsernameInput');
  const confirmButton = document.getElementById('confirmChangeUsernameButton');
  const warning    = document.getElementById('usernameWarning');
  const statusEl   = document.getElementById('changeUsernameStatus');
  const errEl      = document.getElementById('changeUsernameError');

  if (_changeUsernameOpen) {
    warning.style.display    = 'block';
    input.style.display      = '';
    confirmButton.style.display = '';
    input.value              = '';
    statusEl.textContent     = '';
    errEl.textContent        = '';
    confirmButton.disabled      = true;
    input.focus();
  } else {
    warning.style.display    = 'none';
    input.style.display      = 'none';
    confirmButton.style.display = 'none';
  }
}

async function submitUsernameChange() {
  const input    = document.getElementById('changeUsernameInput');
  const errEl    = document.getElementById('changeUsernameError');
  const Button      = document.getElementById('confirmChangeUsernameButton');
  const username = input.value.trim();
  Button.disabled   = true;

  const { error } = await _sb.from('profiles').update({
    username,
    username_changed_at: new Date().toISOString(),
  }).eq('id', _user.id);

  if (error) {
    errEl.textContent = 'Failed to update. Please try again.';
    Button.disabled = false;
    return;
  }

  _profile = await fetchProfile(_user.id);
  renderSidebar();
  toggleChangeUsernameForm();
  _changeUsernameOpen = false;
}

// boot converse
async function bootconverse() {
  const agreed = await hasTosAgreement();
  if (!agreed) {
    showTos();
    return;
  }
  await initconverse();
}

async function hasTosAgreement() {
  const { data } = await _sb
    .from('tos_agreements').select('user_id').eq('user_id', _user.id).maybeSingle();
  return !!data;
}

async function initconverse() {
  updateSidebarSwatch(_profile.color);
  enableconverseInput();
  await fetchHistory();
  subscribeRealtime();
}

function hideAppLoader() {
  const overlay = document.getElementById("appLoadingOverlay");
  if (overlay && !overlay.classList.contains("fade-out")) {
    overlay.classList.add("fade-out");
  }
}

window.addEventListener("load", () => {
  setTimeout(() => hideAppLoader(), 15000);
});

// tos
function showTos() {
  const overlay  = document.getElementById('tosOverlay');
  const body     = document.getElementById('tosBody');
  const checkbox = document.getElementById('tosCheckbox');
  const acceptButton = document.getElementById('tosAcceptButton');

  checkbox.disabled  = true;
  acceptButton.disabled = true;
  overlay.classList.add('active');

  document.fonts.ready.then(() => {
    const needsScroll = body.scrollHeight > body.clientHeight + 4;
    if (!needsScroll) {
      checkbox.disabled = false;
    } else {
      body.addEventListener('scroll', function onScroll() {
        if (body.scrollHeight - body.scrollTop - body.clientHeight < 20) {
          checkbox.disabled = false;
          body.removeEventListener('scroll', onScroll);
        }
      });
    }
  });

  checkbox.addEventListener('change', () => {
    acceptButton.disabled = !checkbox.checked;
  });

  acceptButton.addEventListener('click', async () => {
    acceptButton.disabled = true;
    const { error } = await _sb
      .from('tos_agreements').insert({ user_id: _user.id });
    if (error) {
      document.getElementById('tosError').textContent = 'Something went wrong. Try again.';
      acceptButton.disabled = false;
      return;
    }
    overlay.classList.remove('active');
    initconverse();
  }, { once: true });
}

// message history
async function fetchHistory() {
  const container = document.getElementById('converseMessages');
  container.innerHTML = '<div class="converseSystemMsg">Loading...</div>';

  const isAdminViewer = !!_profile?.is_admin;

  let query = _sb
    .from('converse_messages')
    .select(`
      id, content, created_at, is_private, visible_to, is_deleted, reply_to, user_id,
      profiles ( username, color, is_admin )
    `)
    .order('created_at', { ascending: true })
    .limit(MSG_PAGE_SIZE);

  if (!isAdminViewer) {
    query = query
      .or(`is_private.eq.false,user_id.eq.${_user.id},visible_to.cs.{${_user.id}}`)
      .eq('is_deleted', false);
  }

  const { data: messages, error } = await query;

  container.innerHTML = '';

  if (error) {
    appendSystemMsg('Failed to load messages.'); return;
  }
  if (!messages?.length) {
    appendSystemMsg('No messages yet. Say something!'); return;
  }

  const replyIds = [...new Set(messages.filter(m => m.reply_to).map(m => m.reply_to))];
  let replyMap = new Map();
  if (replyIds.length) {
    const { data: replies } = await _sb
      .from('converse_messages')
      .select('id, content, is_deleted, user_id, profiles ( username, color, is_admin )')
      .in('id', replyIds);
    replyMap = new Map((replies || []).map(r => [r.id, r]));
  }

  const userIds  = [...new Set(messages.map(m => m.user_id))].filter(Boolean);
  const bannedIds = await fetchBannedIds(userIds);

  messages.forEach(msg => renderMessage(
    { ...msg, reply_message: msg.reply_to ? replyMap.get(msg.reply_to) : null },
    bannedIds
  ));
  scrollToBottom();
}

async function fetchBannedIds(userIds) {
  if (!userIds.length) return new Set();
  const now = new Date().toISOString();
  const { data } = await _sb
    .from('suspensions')
    .select('user_id')
    .in('user_id', userIds)
    .or(`is_permanent.eq.true,expires_at.gt.${now}`);
  return new Set((data || []).map(r => r.user_id));
}

// realtime
function subscribeRealtime() {
  if (_realtimeSub) { _sb.removeChannel(_realtimeSub); _realtimeSub = null; }
  clearTimeout(_reconnTimer);

  _realtimeSub = _sb
    .channel('converse:messages')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'converse_messages' },
      async payload => {
        const msg = payload.new;
        if (msg.is_deleted) return;

        const isPublic    = !msg.is_private;
        const isSender    = msg.user_id === _user.id;
        const isRecipient = Array.isArray(msg.visible_to) && msg.visible_to.includes(_user.id);
        const isAdmin     = _profile?.is_admin;
        if (!isPublic && !isSender && !isRecipient && !isAdmin) return;

        const { data: profile } = await _sb
          .from('profiles').select('username, color, is_admin')
          .eq('id', msg.user_id).maybeSingle();

        let replyMessage = null;
        if (msg.reply_to) {
          const { data: rm } = await _sb
            .from('converse_messages')
            .select('id, content, is_deleted, user_id, profiles ( username, color, is_admin )')
            .eq('id', msg.reply_to).maybeSingle();
          replyMessage = rm;
        }

        const isBanned = !!(await fetchActiveSuspension(msg.user_id));
        const bannedIds = isBanned ? new Set([msg.user_id]) : new Set();

        document.querySelectorAll('.converseSystemMsg').forEach(el => el.remove());

        renderMessage({ ...msg, profiles: profile, reply_message: replyMessage }, bannedIds);
        scrollToBottom();
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'converse_messages' },
      payload => {
        const msg = payload.new;

        if (msg.user_id === null && payload.old?.user_id) {
          const authoredEl = document.querySelector(`.msg[data-msg-id="${msg.id}"]`);
          if (authoredEl) {
            const usernameSpan = authoredEl.querySelector('.msgUsername');
            if (usernameSpan) {
              usernameSpan.textContent = 'Deleted User';
              usernameSpan.classList.remove('rainbow');
              usernameSpan.style.color = DELETED_USER_COLOR;
            }
            authoredEl.dataset.userId = '';
          }
        }

        if (!msg.is_deleted) return;

        const el = document.querySelector(`.msg[data-msg-id="${msg.id}"]`);
        if (!el) return;

        if (_profile?.is_admin) {
          markMessageDeleted(el);
        } else {
          const wrapper = el.closest('.msgWrapper') || el;
          wrapper.style.transition = 'opacity 0.2s';
          wrapper.style.opacity    = '0';
          setTimeout(() => wrapper.remove(), 220);
        }
      })
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'converse_messages' },
      payload => {
        const id = payload.old?.id;
        if (!id) return;

        const row = document.querySelector(`.msg[data-msg-id="${id}"]`);
        if (row) {
          const wrapper = row.closest('.msgWrapper') || row;
          wrapper.style.transition = 'opacity 0.2s';
          wrapper.style.opacity    = '0';
          setTimeout(() => wrapper.remove(), 220);
        }

        document.querySelectorAll(`.msgReplyPreview[data-reply-target-id="${id}"]`)
          .forEach(preview => preview.remove());
      })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'suspensions' },
      async payload => {
        const s = payload.new;
        const isActive = s.is_permanent || (s.expires_at && new Date(s.expires_at) > new Date());
        if (!isActive) return;

        setUserBannedTag(s.user_id, true);

        if (s.user_id === _user.id) {
          const suspension = await fetchActiveSuspension(_user.id);
          if (suspension) {
            disableconverseInput();
            showView('banned', suspension);
          }
        }
      })
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'suspensions' },
      payload => {
        const s = payload.old;
        if (!s?.user_id) return;

        setUserBannedTag(s.user_id, false);

        if (s.user_id === _user.id) {
          showView('converse');
          enableconverseInput();
        }
      })
    .subscribe(status => {
      clearTimeout(_reconnTimer);
      const noticeEl = document.getElementById('connectionNotice');

      if (status === 'SUBSCRIBED') {
        if (noticeEl) noticeEl.textContent = '';
        enableconverseInput();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (noticeEl) noticeEl.textContent = 'Reconnecting...';
        disableconverseInput();
        _reconnTimer = setTimeout(subscribeRealtime, 3000);
      }
    });
}

function setUserBannedTag(userId, isBanned) {
  document.querySelectorAll(`.msg[data-user-id="${userId}"]`).forEach(row => {
    const meta = row.querySelector('.msgMeta');
    if (!meta) return;
    const existing = meta.querySelector('.msgBannedTag');
    if (isBanned && !existing) {
      const tag = document.createElement('span');
      tag.className   = 'msgBannedTag';
      tag.textContent = 'Banned';
      const usernameSpan = meta.querySelector('.msgUsername');
      meta.insertBefore(tag, usernameSpan);
    } else if (!isBanned && existing) {
      existing.remove();
    }
  });
}

function markMessageDeleted(el) {
  if (el.classList.contains('msgDeleted')) return;
  el.classList.add('msgDeleted');
  el.querySelector('.msgReplyButton')?.remove();
  el.querySelector('.msgDeleteButton')?.remove();
  if (!el.querySelector('.msgDeletedTag')) {
    const tag = document.createElement('span');
    tag.className   = 'msgDeletedTag';
    tag.textContent = ' [deleted by user]';
    el.querySelector('.msgContent')?.after(tag);
  }
}

function renderMessage(msg, bannedIds = new Set()) {
  const container    = document.getElementById('converseMessages');
  const profile      = msg.profiles;
  const isDeletedUser = msg.user_id === null;
  const username  = isDeletedUser ? 'Deleted User' : (profile?.username ?? 'Unknown');
  const color     = isDeletedUser ? DELETED_USER_COLOR : (profile?.color ?? '#968cff');
  const isAdmin   = isDeletedUser ? false : (profile?.is_admin ?? false);
  const isOwn     = msg.user_id === _user.id;
  const isBanned  = bannedIds.has(msg.user_id);
  const isPrivate = msg.is_private;
  const isDeleted = !!msg.is_deleted;
  const isAdminViewer = !!_profile?.is_admin;

  const time = new Date(msg.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const row = document.createElement('div');
  row.className      = 'msg' + (isDeleted ? ' msgDeleted' : '');
  row.dataset.msgId  = msg.id;
  row.dataset.userId = msg.user_id;

  const usernameSpan = document.createElement('span');
  usernameSpan.className = 'msgUsername' + (isAdmin ? ' rainbow' : '');
  if (!isAdmin) usernameSpan.style.color = color;
  usernameSpan.textContent = username;

  const bannedTag = isBanned
    ? Object.assign(document.createElement('span'), {
        className:   'msgBannedTag',
        textContent: 'Banned',
      })
    : null;

  const privateTag = isPrivate
    ? Object.assign(document.createElement('span'), {
        className:   'msgPrivateTag',
        textContent: 'Private',
      })
    : null;

  const timeSpan = Object.assign(document.createElement('span'), {
    className:   'msgTime',
    textContent: time,
  });

  const colon = Object.assign(document.createElement('span'), {
    className:   'msgColon',
    textContent: ': ',
  });
  const content = Object.assign(document.createElement('span'), {
    className:   'msgContent',
    textContent: msg.content,
  });

  const meta = document.createElement('span');
  meta.className = 'msgMeta';
  meta.appendChild(timeSpan);
  if (bannedTag)  meta.appendChild(bannedTag);
  if (privateTag) meta.appendChild(privateTag);
  meta.appendChild(usernameSpan);

  row.appendChild(meta);
  row.appendChild(colon);
  row.appendChild(content);

  if (isDeleted) {
    const deletedTag = Object.assign(document.createElement('span'), {
      className:   'msgDeletedTag',
      textContent: ' [deleted by user]',
    });
    row.appendChild(deletedTag);
  }

  if (!isDeleted) {
    const replyButton = document.createElement('button');
    replyButton.className   = 'msgActionButton msgReplyButton';
    replyButton.textContent = 'Reply';
    replyButton.addEventListener('click', () => startReply(msg.id, username));
    row.appendChild(replyButton);
  }

  if (isOwn && !isDeleted) {
    const delButton = document.createElement('button');
    delButton.className   = 'msgActionButton msgDeleteButton';
    delButton.textContent = 'Delete';
    delButton.addEventListener('click', () => softDeleteMsg(msg.id, row));
    row.appendChild(delButton);
  }

  if (isAdminViewer) {
    const hardDelButton = document.createElement('button');
    hardDelButton.className   = 'msgActionButton msgHardDeleteButton';
    hardDelButton.textContent = 'Delete';
    hardDelButton.addEventListener('click', () => adminHardDelete(msg.id, hardDelButton));
    row.appendChild(hardDelButton);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'msgWrapper';

  if (msg.reply_message) {
    const rm             = msg.reply_message;
    const rmDeletedUser  = rm.user_id === null;
    const rmAuthor       = rmDeletedUser ? 'Deleted User' : (rm.profiles?.username ?? 'Unknown');
    const rmText         = rm.is_deleted ? '[deleted message]' : rm.content;
    const rmSnippet      = rmText.length > 80 ? rmText.slice(0, 80) + '…' : rmText;

    const preview = document.createElement('div');
    preview.className = 'msgReplyPreview';
    preview.dataset.replyTargetId = msg.reply_to;

    const arrow = Object.assign(document.createElement('span'), {
      className: 'msgReplyArrow', textContent: '↪',
    });
    const rmIsAdmin = !rmDeletedUser && !!rm.profiles?.is_admin;
    const rmAuthorSpan = Object.assign(document.createElement('span'), {
      className: 'msgReplyAuthor' + (rmIsAdmin ? ' rainbow' : ''), textContent: rmAuthor,
    });
    if (!rm.is_deleted && !rmIsAdmin) {
      rmAuthorSpan.style.color = rmDeletedUser ? DELETED_USER_COLOR : (rm.profiles?.color ?? '#968cff');
    }
    const rmColon = Object.assign(document.createElement('span'), {
      className: 'msgReplyColon', textContent: ': ',
    });
    const rmTextSpan = Object.assign(document.createElement('span'), {
      className: 'msgReplyText', textContent: rmSnippet,
    });

    preview.appendChild(arrow);
    preview.appendChild(rmAuthorSpan);
    preview.appendChild(rmColon);
    preview.appendChild(rmTextSpan);
    preview.addEventListener('click', () => {
      const target = document.querySelector(`.msg[data-msg-id="${msg.reply_to}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('msgHighlight');
        setTimeout(() => target.classList.remove('msgHighlight'), 1200);
      }
    });

    wrapper.appendChild(preview);
  }

  wrapper.appendChild(row);
  container.appendChild(wrapper);
}

// send message
async function sendMessage() {
  const input   = document.getElementById('converseInput');
  const content = input.value.trim();
  if (!content || content.length > MAX_MSG_LENGTH) return;

  const now = Date.now();
  if (now - _lastSentAt < SEND_COOLDOWN) {
    showInputError('Slow down!'); return;
  }

  const privateToggle = document.getElementById('privateToggle');
  const isPrivate = privateToggle.checked;

  let visibleTo = null;
  if (isPrivate) {
    if (!_privateRecipients.length) {
      showInputError('Add at least one recipient.'); return;
    }
    visibleTo = [_user.id, ..._privateRecipients.map(r => r.id)];
  }

  disableconverseInput();

  const { error } = await _sb.from('converse_messages').insert({
    user_id:    _user.id,
    content,
    is_private: isPrivate,
    visible_to: visibleTo,
    reply_to:   _replyToId,
  });

  enableconverseInput();

  if (error) {
    const isRate = error.code === '42501' || error.message?.includes('row-level');
    showInputError(isRate ? 'Sending too fast.' : 'Failed to send. Try again.');
    return;
  }

  _lastSentAt = Date.now();
  input.value = '';
  document.getElementById('charCounter').textContent = `0/${MAX_MSG_LENGTH}`;

  if (isPrivate) {
    _privateRecipients = [];
    document.getElementById('privateRecipients').value = '';
    renderPrivateChips();
  }

  clearReply();
}

// delete message
async function softDeleteMsg(msgId, rowEl) {
  rowEl.style.transition = 'opacity 0.2s';
  rowEl.style.opacity    = '0';

  const { error } = await _sb.from('converse_messages')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', msgId).eq('user_id', _user.id);

  if (error) {
    rowEl.style.opacity = '';
    showInputError('Could not delete message.'); return;
  }
  setTimeout(() => rowEl.remove(), 220);
}

// reply
function startReply(msgId, username) {
  _replyToId   = msgId;
  _replyToName = username;
  const bar = document.getElementById('replyBar');
  document.getElementById('replyBarName').textContent = username;
  bar.style.display = 'flex';
  document.getElementById('converseInput').focus();
}

function clearReply() {
  _replyToId   = null;
  _replyToName = null;
  const bar = document.getElementById('replyBar');
  if (bar) bar.style.display = 'none';
}

// input helpers
function enableconverseInput() {
  const i = document.getElementById('converseInput');
  const b = document.getElementById('converseSendButton');
  if (i) i.disabled = false;
  if (b) b.disabled = false;
}

function disableconverseInput() {
  const i = document.getElementById('converseInput');
  const b = document.getElementById('converseSendButton');
  if (i) i.disabled = true;
  if (b) b.disabled = true;
}

let _inputErrTimer = null;
function showInputError(text) {
  const el = document.getElementById('converseInputError');
  if (!el) return;
  el.textContent  = text;
  el.style.display = 'inline';
  clearTimeout(_inputErrTimer);
  _inputErrTimer = setTimeout(() => {
    el.style.display = 'none';
    el.textContent   = '';
  }, 3000);
}

function appendSystemMsg(text) {
  const container = document.getElementById('converseMessages');
  const el = document.createElement('div');
  el.className   = 'converseSystemMsg';
  el.textContent = text;
  container.appendChild(el);
}

function scrollToBottom() {
  const c = document.getElementById('converseMessages');
  if (c) c.scrollTop = c.scrollHeight;
}

// private recipients
async function addPrivateRecipient() {
  const input = document.getElementById('privateRecipients');
  const errEl = document.getElementById('privateError');
  const name  = input.value.trim();
  errEl.textContent = '';

  if (!name) return;

  if (name.toLowerCase() === _profile?.username?.toLowerCase()) {
    errEl.textContent = "You can't add yourself.";
    return;
  }
  if (_privateRecipients.some(r => r.username.toLowerCase() === name.toLowerCase())) {
    errEl.textContent = 'Already added.';
    input.value = '';
    return;
  }

  const { data, error } = await _sb
    .from('profiles').select('id, username').ilike('username', name).maybeSingle();

  if (error) { errEl.textContent = 'Could not look up user.'; return; }
  if (!data)  { errEl.textContent = `User "${name}" not found.`; return; }

  _privateRecipients.push({ id: data.id, username: data.username });
  input.value = '';
  renderPrivateChips();
}

function renderPrivateChips() {
  const wrap = document.getElementById('privateRecipientsChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  _privateRecipients.forEach(r => {
    const chip = document.createElement('span');
    chip.className = 'privateChip';

    const label = document.createElement('span');
    label.textContent = r.username;

    const removeButton = document.createElement('button');
    removeButton.type        = 'button';
    removeButton.className   = 'privateChipRemove';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => removePrivateRecipient(r.id));

    chip.appendChild(label);
    chip.appendChild(removeButton);
    wrap.appendChild(chip);
  });
}

function removePrivateRecipient(id) {
  _privateRecipients = _privateRecipients.filter(r => r.id !== id);
  renderPrivateChips();
}

async function adminHardDelete(msgId, ButtonEl) {
  if (ButtonEl) { ButtonEl.disabled = true; ButtonEl.textContent = '...'; }

  const { error } = await _sb.from('converse_messages').delete().eq('id', msgId);

  if (error) {
    console.error('[Admin] Hard delete error:', error);
    if (ButtonEl) { ButtonEl.disabled = false; ButtonEl.textContent = 'Hard Delete'; }
    return;
  }
}

// admin user search
function bindAdminSearch() {
  const searchInput = document.getElementById('adminSearchInput');
  if (!searchInput || searchInput.dataset.bound) return;
  searchInput.dataset.bound = 'true';

  let timer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = searchInput.value.trim();
      const results = document.getElementById('adminSearchResults');
      results.innerHTML = '';
      if (!q || q.length < 2) return;

      const { data } = await _sb
        .from('profiles').select('id, username, color')
        .ilike('username', `%${q}%`).limit(6);

      if (!data?.length) {
        results.innerHTML = '<div style="font-family:var(--fontMono);font-size:0.75rem;color:var(--textMuted);">No users found.</div>';
        return;
      }

      data.forEach(u => {
        const row = document.createElement('div');
        row.className = 'adminUserRow';
        row.innerHTML = `
          <div class="adminUserDot" style="background:${escapeHTML(u.color)}"></div>
          <span style="font-family:var(--fontMono);font-size:0.8rem;">${escapeHTML(u.username)}</span>`;
        row.addEventListener('click', () => openBanForm(u.id, u.username));
        results.appendChild(row);
      });
    }, 350);
  });

  document.getElementById('adminBanPerm').addEventListener('change', e => {
    document.getElementById('adminBanDays').disabled = e.target.checked;
  });

  document.getElementById('adminBanSubmitButton').addEventListener('click', submitBan);
  document.getElementById('adminBanCancelButton').addEventListener('click', closeBanForm);
}

function openBanForm(userId, username) {
  _banTargetId   = userId;
  _banTargetName = username;
  document.getElementById('adminBanTargetName').textContent = username;
  document.getElementById('adminBanReason').value = '';
  document.getElementById('adminBanDays').value   = '';
  document.getElementById('adminBanPerm').checked = false;
  document.getElementById('adminBanDays').disabled = false;
  document.getElementById('adminBanError').textContent = '';
  document.getElementById('adminBanForm').style.display = 'flex';
  document.getElementById('adminSearchResults').innerHTML = '';
  document.getElementById('adminSearchInput').value = '';
}

function closeBanForm() {
  _banTargetId   = null;
  _banTargetName = null;
  document.getElementById('adminBanForm').style.display = 'none';
}

async function submitBan() {
  const reason    = document.getElementById('adminBanReason').value.trim();
  const days      = parseInt(document.getElementById('adminBanDays').value, 10);
  const isPerm    = document.getElementById('adminBanPerm').checked;
  const errEl     = document.getElementById('adminBanError');
  const submitButton = document.getElementById('adminBanSubmitButton');

  errEl.textContent = '';
  if (!_banTargetId)            { errEl.textContent = 'No user selected.'; return; }
  if (!reason)                  { errEl.textContent = 'Reason is required.'; return; }
  if (!isPerm && (!days || days < 1)) { errEl.textContent = 'Enter a valid number of days.'; return; }

  submitButton.disabled = true;

  const expiresAt = isPerm ? null : new Date(Date.now() + days * 864e5).toISOString();

  const { error } = await _sb.from('suspensions').insert({
    user_id:      _banTargetId,
    reason,
    is_permanent: isPerm,
    expires_at:   expiresAt,
  });

  submitButton.disabled = false;

  if (error) { errEl.textContent = 'Failed: ' + error.message; return; }

  closeBanForm();
  loadAdminBans();
}

// active bans
async function loadAdminBans() {
  const container = document.getElementById('adminBansList');
  if (!container) return;

  const now = new Date().toISOString();
  const { data } = await _sb
    .from('suspensions')
    .select('id, reason, expires_at, is_permanent, user_id, profiles(username, color)')
    .or(`is_permanent.eq.true,expires_at.gt.${now}`)
    .order('created_at', { ascending: false });

  container.innerHTML = '';
  if (!data?.length) {
    container.innerHTML = '<div style="font-family:var(--fontMono);font-size:0.75rem;color:var(--textMuted);">No active bans.</div>';
    return;
  }

  data.forEach(s => {
    const expiryText = s.is_permanent
      ? 'Permanent'
      : (() => {
          const d = Math.ceil((new Date(s.expires_at) - new Date()) / 864e5);
          return `${d} day${d !== 1 ? 's' : ''} left`;
        })();

    const row = document.createElement('div');
    row.className = 'banRow';
    row.innerHTML = `
      <div class="banRowInfo">
        <div class="banRowUser" style="color:${escapeHTML(s.profiles?.color ?? '#968cff')}">
          ${escapeHTML(s.profiles?.username ?? 'Unknown')}
        </div>
        <div class="banRowDetail">${escapeHTML(s.reason)} &bull; ${expiryText}</div>
      </div>`;

    const unbanButton = document.createElement('button');
    unbanButton.className   = 'adminUnbanButton';
    unbanButton.textContent = 'Unban';
    unbanButton.addEventListener('click', async () => {
      unbanButton.disabled = true;
      const { error } = await _sb.from('suspensions').delete().eq('id', s.id);
      if (!error) { row.remove(); } else { unbanButton.disabled = false; }
    });

    row.appendChild(unbanButton);
    container.appendChild(row);
  });
}

function bindStaticEvents() {
  document.getElementById('ButtonGoogle')
    .addEventListener('click', () => signInWith('google'));
  document.getElementById('ButtonDiscord')
    .addEventListener('click', () => signInWith('discord'));

  const setupInput = document.getElementById('setupUsernameInput');
  setupInput.addEventListener('input', () => {
    checkUsernameInput(
      setupInput.value.trim(),
      document.getElementById('setupUsernameStatus'),
      document.getElementById('setupUsernameError'),
      document.getElementById('setupSubmitButton'),
    );
  });
  document.getElementById('setupSubmitButton')
    .addEventListener('click', submitSetup);

  document.getElementById('signoutButton')
    .addEventListener('click', async () => {
      await _sb.auth.signOut();
    });

  document.getElementById('toggleChangeUsernameButton')
    .addEventListener('click', toggleChangeUsernameForm);

  const changeInput = document.getElementById('changeUsernameInput');
  changeInput.addEventListener('input', () => {
    checkUsernameInput(
      changeInput.value.trim(),
      document.getElementById('changeUsernameStatus'),
      document.getElementById('changeUsernameError'),
      document.getElementById('confirmChangeUsernameButton'),
    );
  });
  document.getElementById('confirmChangeUsernameButton')
    .addEventListener('click', submitUsernameChange);

  const converseInput = document.getElementById('converseInput');
  converseInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  converseInput.addEventListener('input', () => {
    const len = converseInput.value.length;
    const counter = document.getElementById('charCounter');
    if (counter) counter.textContent = `${len}/${MAX_MSG_LENGTH}`;
  });
  document.getElementById('converseSendButton')
    .addEventListener('click', sendMessage);

  const privateToggle = document.getElementById('privateToggle');
  const privatePanel  = document.getElementById('privatePanel');

  privateToggle.checked = false;
  privatePanel.style.display = 'none';

  privateToggle.addEventListener('change', () => {
    privatePanel.style.display = privateToggle.checked ? 'block' : 'none';
    _privateRecipients = [];
    document.getElementById('privateRecipients').value = '';
    renderPrivateChips();
  });

  document.getElementById('privateRecipients')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addPrivateRecipient(); }
    });
  document.getElementById('privateAddButton')
    .addEventListener('click', addPrivateRecipient);

  document.getElementById('replyCancelButton')
    .addEventListener('click', clearReply);

  document.getElementById('togglePasskeySigninButton')
    .addEventListener('click', () => {
      const form = document.getElementById('passkeySigninForm');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
  document.getElementById('passkeyLoginSubmitButton')
    .addEventListener('click', submitPasskeyLogin);
  document.getElementById('passkeyLoginToken')
    .addEventListener('keydown', e => { if (e.key === 'Enter') submitPasskeyLogin(); });
  document.getElementById('passkeyLoginEmail')
    .addEventListener('keydown', e => { if (e.key === 'Enter') submitPasskeyLogin(); });

  document.getElementById('passkeyEnabledToggle')
    .addEventListener('change', handlePasskeyToggleChange);
  document.getElementById('passkeyResetButton')
    .addEventListener('click', generatePasskey);
  document.getElementById('passkeyTokenCopyButton')
    .addEventListener('click', copyPasskeyToken);
  document.getElementById('passkeyTokenDoneButton')
    .addEventListener('click', closePasskeyModal);

  // account deletion
  document.getElementById('deleteAccountButton')
    .addEventListener('click', openDeleteAccountModal);
  document.getElementById('deleteAccountCancelButton')
    .addEventListener('click', closeDeleteAccountModal);
  document.getElementById('deleteAccountConfirmButton')
    .addEventListener('click', confirmDeleteAccount);
  document.getElementById('cancelDeletionButton')
    .addEventListener('click', cancelAccountDeletion);
}

function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}