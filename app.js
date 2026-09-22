/**
 * YMMAMA YOUZKN — نظام الإبلاغ والإدارة
 * Firebase Realtime Database only (no Storage)
 */

// انتظار تهيئة Firebase
function waitForFirebase() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.firebaseApp) resolve(window.firebaseApp);
      else setTimeout(check, 50);
    };
    check();
  });
}

let auth, db, ref, set, get, push, update, onValue, query, orderByChild, equalTo, child;
let signInWithEmailAndPassword, signOut, onAuthStateChanged;

let currentUser = null;
let currentUserData = null;
let isAdmin = false;
let pendingReportData = null;
let currentSearchTarget = null; // 'user' | 'copyright'
let currentDetailReportId = null;
let currentChatRoomId = null;
let chatUnsubscribe = null;
let secretClicks = 0;
let secretTimer = null;

// ===== أدوات مساعدة =====
function $(id) { return document.getElementById(id); }
function show(el) { if (typeof el === 'string') el = $(el); if (el) el.classList.remove('hidden'); }
function hide(el) { if (typeof el === 'string') el = $(el); if (el) el.classList.add('hidden'); }
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  show(pageId);
  window.scrollTo(0, 0);
}
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  show(t);
  setTimeout(() => hide(t), 3200);
}
function statusClass(status) {
  return 'status-' + (status || '').replace(/\s+/g, '-');
}
function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}
function generateReportId() {
  return new Promise(async (resolve) => {
    const counterRef = ref(db, 'counters/reports');
    const snap = await get(counterRef);
    let num = 1;
    if (snap.exists()) num = snap.val() + 1;
    await set(counterRef, num);
    resolve('YMM-REPORT-' + String(num).padStart(6, '0'));
  });
}

// تحويل صورة إلى Base64 مع ضغط
function fileToBase64(file, maxSize = 400) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('حجم الصورة كبير جدًا (الحد 2 ميجا)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('فشل تحميل الصورة'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

async function filesToBase64(files) {
  const results = [];
  for (const f of files) {
    try {
      const b64 = await fileToBase64(f);
      if (b64) results.push(b64);
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return results;
}

function previewImages(input, containerId) {
  const container = $(containerId);
  container.innerHTML = '';
  if (!input.files) return;
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.src = e.target.result;
      container.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

// ===== تهيئة =====
async function init() {
  const fb = await waitForFirebase();
  auth = fb.auth;
  db = fb.db;
  ref = fb.ref;
  set = fb.set;
  get = fb.get;
  push = fb.push;
  update = fb.update;
  onValue = fb.onValue;
  query = fb.query;
  orderByChild = fb.orderByChild;
  equalTo = fb.equalTo;
  child = fb.child;
  signInWithEmailAndPassword = fb.signInWithEmailAndPassword;
  signOut = fb.signOut;
  onAuthStateChanged = fb.onAuthStateChanged;

  setupEventListeners();

  onAuthStateChanged(auth, async (user) => {
    hide('loading-screen');
    if (user) {
      currentUser = user;
      await loadUserData(user.uid);
      await checkAdminStatus(user.uid);
      showPage('home-page');
      updateHeader();
    } else {
      currentUser = null;
      currentUserData = null;
      isAdmin = false;
      showPage('login-page');
    }
  });
}

async function loadUserData(uid) {
  try {
    const snap = await get(ref(db, 'users/' + uid));
    if (snap.exists()) {
      currentUserData = snap.val();
    } else {
      // إنشاء سجل مستخدم أساسي من بيانات Auth
      currentUserData = {
        uid,
        email: currentUser.email,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        age: null,
        createdAt: Date.now()
      };
      await set(ref(db, 'users/' + uid), currentUserData);
    }
  } catch (e) {
    console.error('loadUserData', e);
    currentUserData = {
      uid,
      email: currentUser.email,
      username: currentUser.email.split('@')[0]
    };
  }
}

async function checkAdminStatus(uid) {
  try {
    const snap = await get(ref(db, 'adminUsers/' + uid));
    isAdmin = snap.exists() && snap.val() === true;
  } catch (e) {
    isAdmin = false;
  }
}

function updateHeader() {
  const name = currentUserData?.username || currentUserData?.name || currentUser?.email || '—';
  const email = currentUser?.email || '—';
  $('header-username').textContent = name;
  $('header-email').textContent = email;
  if (currentUserData?.photoBase64) {
    $('header-avatar').innerHTML = `<img src="${currentUserData.photoBase64}" alt="">`;
  } else {
    $('header-avatar').textContent = '👤';
  }
  // تعبئة البريد في النماذج
  const emailFields = ['report-contact-email', 'problem-contact', 'admin-contact', 'content-contact', 'copyright-contact'];
  emailFields.forEach(id => {
    const el = $(id);
    if (el) el.value = email;
  });
}

// ===== تسجيل الدخول =====
function setupEventListeners() {
  // تسجيل الدخول
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const errEl = $('login-error');
    hide(errEl);
    const btn = $('login-btn');
    btn.disabled = true;
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-loader').classList.remove('hidden');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      let msg = 'فشل تسجيل الدخول';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'البريد أو كلمة المرور غير صحيحة';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'البريد الإلكتروني غير صالح';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'محاولات كثيرة، حاول لاحقًا';
      }
      errEl.textContent = msg;
      show(errEl);
    } finally {
      btn.disabled = false;
      btn.querySelector('.btn-text').classList.remove('hidden');
      btn.querySelector('.btn-loader').classList.add('hidden');
    }
  });

  // تسجيل الخروج
  $('logout-btn').addEventListener('click', async () => {
    await signOut(auth);
  });

  // أقسام الصفحة الرئيسية
  document.querySelectorAll('#home-sections .section-card').forEach(card => {
    card.addEventListener('click', () => {
      const section = card.dataset.section;
      navigateToSection(section);
    });
  });

  // أزرار الرجوع
  document.querySelectorAll('.btn-back[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.back;
      if (target === 'home') showPage('home-page');
      else if (target === 'general-report') showPage('general-report-page');
      else if (target === 'friendly-room') showPage('friendly-room-page');
    });
  });

  // أنواع البلاغ العام
  document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      if (type === 'user') showPage('report-user-page');
      else if (type === 'problem') showPage('report-problem-page');
      else if (type === 'admin-reply') showPage('report-admin-page');
      else if (type === 'content') showPage('report-content-page');
    });
  });

  // بحث متهم
  $('btn-search-accused').addEventListener('click', () => {
    currentSearchTarget = 'user';
    openUserSearch();
  });
  $('accused-name').addEventListener('click', () => {
    currentSearchTarget = 'user';
    openUserSearch();
  });
  $('btn-search-copyright-accused').addEventListener('click', () => {
    currentSearchTarget = 'copyright';
    openUserSearch();
  });
  $('copyright-accused-name').addEventListener('click', () => {
    currentSearchTarget = 'copyright';
    openUserSearch();
  });
  $('close-search-modal').addEventListener('click', () => hide('user-search-modal'));
  $('user-search-input').addEventListener('input', debounce(searchUsers, 300));
  $('use-manual-name').addEventListener('click', () => {
    const name = $('manual-accused-name').value.trim();
    if (!name) { toast('أدخل الاسم', 'error'); return; }
    selectAccused({ username: name, uid: null, photoBase64: null, manual: true });
    hide('user-search-modal');
  });

  // معاينة صور
  $('report-evidence').addEventListener('change', () => previewImages($('report-evidence'), 'evidence-preview'));
  $('problem-image').addEventListener('change', () => previewImages($('problem-image'), 'problem-image-preview'));
  $('admin-image').addEventListener('change', () => previewImages($('admin-image'), 'admin-image-preview'));
  $('content-image').addEventListener('change', () => previewImages($('content-image'), 'content-image-preview'));
  $('content-author-photo').addEventListener('change', () => previewImages($('content-author-photo'), 'content-author-preview'));
  $('copyright-original-img').addEventListener('change', () => previewImages($('copyright-original-img'), 'copyright-original-preview'));
  $('copyright-copied-img').addEventListener('change', () => previewImages($('copyright-copied-img'), 'copyright-copied-preview'));
  $('copyright-proof').addEventListener('change', () => previewImages($('copyright-proof'), 'copyright-proof-preview'));
  $('appeal-evidence').addEventListener('change', () => previewImages($('appeal-evidence'), 'appeal-evidence-preview'));

  // إرسال النماذج
  $('form-report-user').addEventListener('submit', (e) => { e.preventDefault(); prepareUserReport(); });
  $('form-report-problem').addEventListener('submit', (e) => { e.preventDefault(); prepareProblemReport(); });
  $('form-report-admin').addEventListener('submit', (e) => { e.preventDefault(); prepareAdminReport(); });
  $('form-report-content').addEventListener('submit', (e) => { e.preventDefault(); prepareContentReport(); });
  $('form-copyright').addEventListener('submit', (e) => { e.preventDefault(); prepareCopyrightReport(); });

  // معاينة
  $('preview-submit').addEventListener('click', submitPendingReport);
  $('preview-edit').addEventListener('click', () => {
    if (pendingReportData?.type === 'user') showPage('report-user-page');
    else if (pendingReportData?.type === 'problem') showPage('report-problem-page');
    else if (pendingReportData?.type === 'admin-reply') showPage('report-admin-page');
    else if (pendingReportData?.type === 'content') showPage('report-content-page');
    else if (pendingReportData?.type === 'copyright') showPage('copyright-page');
  });
  $('preview-back').addEventListener('click', () => $('preview-edit').click());

  // فلاتر بلاغاتي
  document.querySelectorAll('#my-reports-page .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#my-reports-page .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadMyReports(btn.dataset.status);
    });
  });

  // زر سري للإدارة (5 نقرات سريعة)
  $('secret-admin-trigger').addEventListener('click', () => {
    secretClicks++;
    clearTimeout(secretTimer);
    secretTimer = setTimeout(() => { secretClicks = 0; }, 1500);
    if (secretClicks >= 5) {
      secretClicks = 0;
      showPage('admin-login-page');
    }
  });

  // دخول الإدارة
  $('admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('admin-login-email').value.trim();
    const password = $('admin-login-password').value;
    const errEl = $('admin-login-error');
    hide(errEl);
    try {
      // إذا كان المستخدم مسجل دخول بالفعل بنفس الحساب
      if (currentUser && currentUser.email === email) {
        await checkAdminStatus(currentUser.uid);
        if (isAdmin) {
          showPage('admin-panel-page');
          loadAdminTab('reports');
          return;
        }
      }
      // محاولة تسجيل دخول جديد
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await checkAdminStatus(cred.user.uid);
      if (!isAdmin) {
        errEl.textContent = 'هذا الحساب ليس لديه صلاحيات إدارة';
        show(errEl);
        return;
      }
      showPage('admin-panel-page');
      loadAdminTab('reports');
    } catch (err) {
      errEl.textContent = 'فشل الدخول — تحقق من البيانات والصلاحيات';
      show(errEl);
    }
  });
  $('admin-back-home').addEventListener('click', () => showPage(currentUser ? 'home-page' : 'login-page'));
  $('admin-logout').addEventListener('click', () => showPage('home-page'));

  // تبويبات الإدارة
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAdminTab(btn.dataset.adminTab);
    });
  });

  $('admin-report-filter').addEventListener('change', () => loadAdminReports());
  $('admin-status-filter').addEventListener('change', () => loadAdminReports());

  // مودالات الإدارة
  $('close-status-modal').addEventListener('click', () => hide('status-modal'));
  $('new-status').addEventListener('change', () => {
    if ($('new-status').value === 'اتهام باطل') show('false-reason-group');
    else hide('false-reason-group');
  });
  $('confirm-status').addEventListener('click', confirmStatusChange);

  $('btn-create-friendly').addEventListener('click', () => show('create-friendly-modal'));
  $('close-friendly-modal').addEventListener('click', () => hide('create-friendly-modal'));
  $('confirm-create-friendly').addEventListener('click', createFriendlyRoom);

  $('btn-create-thanks').addEventListener('click', () => show('create-thanks-modal'));
  $('close-thanks-modal').addEventListener('click', () => hide('create-thanks-modal'));
  $('confirm-create-thanks').addEventListener('click', createThanks);

  $('close-appeal-modal').addEventListener('click', () => hide('appeal-modal'));
  $('submit-appeal').addEventListener('click', submitAppeal);

  // دردشة
  $('chat-send').addEventListener('click', sendChatMessage);
  $('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  $('detail-back').addEventListener('click', () => {
    // الرجوع حسب السياق
    if (document.querySelector('#my-reports-page:not(.hidden)')) showPage('my-reports-page');
    else if (document.querySelector('#my-accusations-page:not(.hidden)')) showPage('my-accusations-page');
    else if (isAdmin && document.querySelector('#admin-panel-page:not(.hidden)')) showPage('admin-panel-page');
    else showPage('home-page');
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ===== التنقل =====
function navigateToSection(section) {
  switch (section) {
    case 'general-report':
      showPage('general-report-page');
      break;
    case 'my-reports':
      showPage('my-reports-page');
      loadMyReports('all');
      break;
    case 'my-accusations':
      showPage('my-accusations-page');
      loadMyAccusations();
      break;
    case 'thanks':
      showPage('thanks-page');
      loadThanks();
      break;
    case 'copyright':
      showPage('copyright-page');
      break;
    case 'friendly-room':
      showPage('friendly-room-page');
      loadFriendlyRooms();
      break;
  }
}

// ===== البحث عن مستخدمين =====
function openUserSearch() {
  $('user-search-input').value = '';
  $('user-search-results').innerHTML = '';
  $('manual-accused-name').value = '';
  show('user-search-modal');
  $('user-search-input').focus();
}

async function searchUsers() {
  const term = $('user-search-input').value.trim().toLowerCase();
  const resultsEl = $('user-search-results');
  if (term.length < 2) {
    resultsEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px">اكتب حرفين على الأقل...</p>';
    return;
  }
  resultsEl.innerHTML = '<p style="font-size:13px;padding:8px">جاري البحث...</p>';
  try {
    const snap = await get(ref(db, 'users'));
    const results = [];
    if (snap.exists()) {
      snap.forEach(childSnap => {
        const u = childSnap.val();
        const name = (u.username || u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        if (name.includes(term) || email.includes(term)) {
          results.push({ uid: childSnap.key, ...u });
        }
      });
    }
    if (results.length === 0) {
      resultsEl.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px">لم يتم العثور على مستخدم</p>';
      return;
    }
    resultsEl.innerHTML = results.slice(0, 20).map(u => `
      <div class="search-result-item" data-uid="${u.uid}">
        ${u.photoBase64 ? `<img src="${u.photoBase64}" alt="">` : '<span style="font-size:28px">👤</span>'}
        <div>
          <div style="font-weight:600">${u.username || u.name || '—'}</div>
          <div style="font-size:11px;color:var(--text-secondary)">${u.email || ''} ${u.verified ? '✓' : ''}</div>
        </div>
      </div>
    `).join('');
    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const uid = item.dataset.uid;
        const u = results.find(r => r.uid === uid);
        selectAccused(u);
        hide('user-search-modal');
      });
    });
  } catch (e) {
    resultsEl.innerHTML = '<p style="color:var(--danger);font-size:13px">خطأ في البحث</p>';
  }
}

function selectAccused(user) {
  if (currentSearchTarget === 'copyright') {
    $('copyright-accused-name').value = user.username || user.name || '';
    $('copyright-accused-uid').value = user.uid || '';
    const prev = $('copyright-accused-preview');
    if (user.uid) {
      prev.innerHTML = `
        ${user.photoBase64 ? `<img src="${user.photoBase64}">` : '<span>👤</span>'}
        <div><strong>${user.username || user.name}</strong><br><small>${user.uid}</small></div>
      `;
      show(prev);
    } else {
      hide(prev);
    }
  } else {
    $('accused-name').value = user.username || user.name || '';
    $('accused-uid').value = user.uid || '';
    $('accused-photo').value = user.photoBase64 || '';
    const prev = $('accused-preview');
    if (user.uid) {
      prev.innerHTML = `
        ${user.photoBase64 ? `<img src="${user.photoBase64}">` : '<span>👤</span>'}
        <div>
          <strong>${user.username || user.name}</strong><br>
          <small>UID: ${user.uid}</small>
          ${user.verified ? `<br><small>موثق: ${user.verifiedBadge || 'نعم'}</small>` : ''}
        </div>
      `;
      show(prev);
      if (user.verifiedBadge) $('accused-verified').value = user.verifiedBadge;
      else if (user.verified) $('accused-verified').value = 'زرقاء';
    } else {
      hide(prev);
    }
  }
}

// ===== إعداد البلاغات =====
async function prepareUserReport() {
  const accusedName = $('accused-name').value.trim();
  if (!accusedName) { toast('اختر أو اكتب اسم المتهم', 'error'); return; }
  const evidenceFiles = $('report-evidence').files;
  let evidence = [];
  try {
    evidence = await filesToBase64(evidenceFiles);
  } catch (e) { toast(e.message, 'error'); return; }

  pendingReportData = {
    type: 'user',
    typeLabel: 'إبلاغ عن مستخدم',
    accusedName,
    accusedUid: $('accused-uid').value || null,
    accusedPhoto: $('accused-photo').value || null,
    app: $('report-app').value,
    section: $('report-section').value.trim(),
    verified: $('accused-verified').value,
    description: $('report-description').value.trim(),
    evidence,
    link: $('report-link').value.trim(),
    contactEmail: $('report-contact-email').value.trim()
  };
  showPreview();
}

async function prepareProblemReport() {
  let image = null;
  if ($('problem-image').files[0]) {
    try { image = await fileToBase64($('problem-image').files[0]); }
    catch (e) { toast(e.message, 'error'); return; }
  }
  pendingReportData = {
    type: 'problem',
    typeLabel: 'إبلاغ عن مشكلة',
    app: $('problem-app').value,
    section: $('problem-section').value.trim(),
    description: $('problem-description').value.trim(),
    image,
    day: $('problem-day').value,
    month: $('problem-month').value,
    year: $('problem-year').value,
    hour: $('problem-hour').value,
    minute: $('problem-minute').value,
    contactEmail: $('problem-contact').value.trim()
  };
  showPreview();
}

async function prepareAdminReport() {
  let image = null;
  if ($('admin-image').files[0]) {
    try { image = await fileToBase64($('admin-image').files[0]); }
    catch (e) { toast(e.message, 'error'); return; }
  }
  pendingReportData = {
    type: 'admin-reply',
    typeLabel: 'سوء رد من الإدارة',
    app: $('admin-app').value,
    adminName: $('admin-name').value.trim(),
    description: $('admin-description').value.trim(),
    replyText: $('admin-reply-text').value.trim(),
    image,
    time: {
      year: $('admin-year').value,
      month: $('admin-month').value,
      week: $('admin-week').value,
      day: $('admin-day').value,
      hour: $('admin-hour').value,
      minute: $('admin-minute').value,
      second: $('admin-second').value
    },
    contactEmail: $('admin-contact').value.trim()
  };
  showPreview();
}

async function prepareContentReport() {
  let contentImage = null, authorPhoto = null;
  try {
    if ($('content-image').files[0]) contentImage = await fileToBase64($('content-image').files[0]);
    if ($('content-author-photo').files[0]) authorPhoto = await fileToBase64($('content-author-photo').files[0]);
  } catch (e) { toast(e.message, 'error'); return; }
  pendingReportData = {
    type: 'content',
    typeLabel: 'منشور أو رسالة مخالفة',
    violationType: $('content-violation-type').value,
    app: $('content-app').value,
    place: $('content-place').value.trim(),
    authorName: $('content-author').value.trim(),
    authorPhoto,
    contentImage,
    description: $('content-description').value.trim(),
    link: $('content-link').value.trim(),
    contactEmail: $('content-contact').value.trim()
  };
  showPreview();
}

async function prepareCopyrightReport() {
  const accusedName = $('copyright-accused-name').value.trim();
  if (!accusedName) { toast('اختر أو اكتب اسم المتهم', 'error'); return; }
  let originalImg = null, copiedImg = null, proof = [];
  try {
    if ($('copyright-original-img').files[0]) originalImg = await fileToBase64($('copyright-original-img').files[0]);
    if ($('copyright-copied-img').files[0]) copiedImg = await fileToBase64($('copyright-copied-img').files[0]);
    proof = await filesToBase64($('copyright-proof').files);
  } catch (e) { toast(e.message, 'error'); return; }
  pendingReportData = {
    type: 'copyright',
    typeLabel: 'انتهاك حقوق الملكية',
    copyrightType: $('copyright-type').value,
    ownerName: $('copyright-owner-name').value.trim(),
    ownerAccount: $('copyright-owner-account').value.trim(),
    accusedName,
    accusedUid: $('copyright-accused-uid').value || null,
    app: $('copyright-app').value,
    originalLink: $('copyright-original-link').value.trim(),
    copiedLink: $('copyright-copied-link').value.trim(),
    originalImg,
    copiedImg,
    proof,
    description: $('copyright-description').value.trim(),
    contactEmail: $('copyright-contact').value.trim()
  };
  showPreview();
}

function showPreview() {
  const d = pendingReportData;
  let html = `<h3>${d.typeLabel}</h3>`;
  const rows = [];
  if (d.accusedName) rows.push(['المتهم', d.accusedName + (d.accusedUid ? ` (${d.accusedUid})` : ' — يدوي')]);
  if (d.app) rows.push(['التطبيق', d.app]);
  if (d.section) rows.push(['القسم', d.section]);
  if (d.verified) rows.push(['التوثيق', d.verified]);
  if (d.violationType) rows.push(['نوع المخالفة', d.violationType]);
  if (d.copyrightType) rows.push(['نوع الانتهاك', d.copyrightType]);
  if (d.ownerName) rows.push(['صاحب الحق', d.ownerName]);
  if (d.adminName) rows.push(['الإداري', d.adminName]);
  if (d.place) rows.push(['المكان', d.place]);
  if (d.authorName) rows.push(['كاتب المحتوى', d.authorName]);
  if (d.description) rows.push(['الوصف', d.description]);
  if (d.replyText) rows.push(['نص الرد', d.replyText]);
  if (d.link) rows.push(['الرابط', d.link]);
  if (d.originalLink) rows.push(['رابط أصلي', d.originalLink]);
  if (d.copiedLink) rows.push(['رابط منسوخ', d.copiedLink]);
  if (d.contactEmail) rows.push(['للتواصل', d.contactEmail]);
  if (d.day || d.month || d.year) rows.push(['التاريخ', `${d.day || '—'}/${d.month || '—'}/${d.year || '—'}`]);
  if (d.hour !== undefined && d.hour !== '') rows.push(['الوقت', `${d.hour}:${d.minute || '00'}`]);

  rows.forEach(([label, val]) => {
    html += `<div class="preview-row"><div class="preview-label">${label}</div><div>${val}</div></div>`;
  });

  const images = [];
  if (d.evidence) images.push(...d.evidence);
  if (d.image) images.push(d.image);
  if (d.contentImage) images.push(d.contentImage);
  if (d.authorPhoto) images.push(d.authorPhoto);
  if (d.originalImg) images.push(d.originalImg);
  if (d.copiedImg) images.push(d.copiedImg);
  if (d.proof) images.push(...d.proof);
  if (d.accusedPhoto) images.push(d.accusedPhoto);

  if (images.length) {
    html += `<div class="preview-row"><div class="preview-label">الصور / الأدلة</div>`;
    images.forEach(src => { html += `<img src="${src}" style="max-width:120px;margin:4px">`; });
    html += `</div>`;
  }

  $('preview-content').innerHTML = html;
  showPage('preview-page');
}

async function submitPendingReport() {
  if (!pendingReportData || !currentUser) return;
  const btn = $('preview-submit');
  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';
  try {
    const reportId = await generateReportId();
    const now = Date.now();
    const report = {
      reportId,
      type: pendingReportData.type,
      typeLabel: pendingReportData.typeLabel,
      status: 'قيد الرؤية من الإدارة',
      createdAt: now,
      updatedAt: now,
      reporterUid: currentUser.uid,
      reporterEmail: currentUser.email,
      reporterName: currentUserData?.username || currentUserData?.name || currentUser.email,
      ...pendingReportData,
      statusHistory: [{
        status: 'قيد الرؤية من الإدارة',
        at: now,
        by: 'system',
        note: 'تم إنشاء البلاغ'
      }]
    };
    // تنظيف حقول غير ضرورية
    delete report.typeLabel;

    await set(ref(db, 'reports/' + reportId), report);

    // إذا كان هناك متهم بـ UID، أضف إشارة في accusations
    if (report.accusedUid) {
      await set(ref(db, 'accusations/' + report.accusedUid + '/' + reportId), {
        reportId,
        status: report.status,
        type: report.type,
        createdAt: now,
        reporterUid: currentUser.uid
      });
    }

    // إشعار للإدارة (اختياري)
    await push(ref(db, 'notifications/admin'), {
      type: 'new_report',
      reportId,
      at: now,
      message: `بلاغ جديد: ${reportId}`
    });

    toast(`تم إرسال البلاغ بنجاح\n${reportId}`, 'success');
    pendingReportData = null;
    // مسح النماذج
    resetForms();
    showPage('my-reports-page');
    loadMyReports('all');
  } catch (e) {
    console.error(e);
    toast('فشل إرسال البلاغ: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'تأكيد الإرسال';
  }
}

function resetForms() {
  ['form-report-user', 'form-report-problem', 'form-report-admin', 'form-report-content', 'form-copyright'].forEach(id => {
    const f = $(id);
    if (f) f.reset();
  });
  document.querySelectorAll('.images-preview').forEach(el => el.innerHTML = '');
  document.querySelectorAll('.user-preview').forEach(el => { el.innerHTML = ''; el.classList.add('hidden'); });
}

// ===== بلاغاتي =====
async function loadMyReports(statusFilter = 'all') {
  const list = $('my-reports-list');
  list.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">جاري التحميل...</p>';
  try {
    const snap = await get(ref(db, 'reports'));
    const items = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const r = s.val();
        if (r.reporterUid === currentUser.uid) {
          if (statusFilter === 'all' || r.status === statusFilter) items.push(r);
        }
      });
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>لا توجد بلاغات</p></div>';
      return;
    }
    list.innerHTML = items.map(r => renderReportCard(r)).join('');
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openReportDetail(card.dataset.id, 'reporter'));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ في التحميل</p>';
  }
}

function renderReportCard(r) {
  return `
    <div class="report-card" data-id="${r.reportId}">
      <div class="report-card-header">
        <span class="report-id">${r.reportId}</span>
        <span class="status-badge ${statusClass(r.status)}">${r.status}</span>
      </div>
      <div class="report-meta">
        ${r.typeLabel || typeLabel(r.type)} · ${formatDate(r.createdAt)}
        ${r.accusedName ? `<br>المتهم: ${r.accusedName}` : ''}
        ${r.app ? `<br>${r.app}` : ''}
      </div>
      <span class="report-type-tag">${typeLabel(r.type)}</span>
    </div>
  `;
}

function typeLabel(type) {
  const map = {
    user: 'إبلاغ عن مستخدم',
    problem: 'مشكلة',
    'admin-reply': 'سوء رد إدارة',
    content: 'محتوى مخالف',
    copyright: 'حقوق ملكية'
  };
  return map[type] || type;
}

// ===== التهم =====
async function loadMyAccusations() {
  const list = $('my-accusations-list');
  list.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">جاري التحميل...</p>';
  try {
    const accSnap = await get(ref(db, 'accusations/' + currentUser.uid));
    if (!accSnap.exists()) {
      list.innerHTML = '<div class="empty-state"><p>لا توجد تهم موجهة إليك</p></div>';
      return;
    }
    const reportIds = [];
    accSnap.forEach(s => reportIds.push(s.key));
    const items = [];
    for (const rid of reportIds) {
      const rSnap = await get(ref(db, 'reports/' + rid));
      if (rSnap.exists()) items.push(rSnap.val());
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.map(r => renderReportCard(r)).join('');
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openReportDetail(card.dataset.id, 'accused'));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ في التحميل</p>';
  }
}

// ===== تفاصيل البلاغ =====
async function openReportDetail(reportId, role) {
  currentDetailReportId = reportId;
  const content = $('detail-content');
  const actions = $('detail-actions');
  content.innerHTML = '<p>جاري التحميل...</p>';
  actions.innerHTML = '';
  showPage('report-detail-page');
  $('detail-title').textContent = role === 'accused' ? 'تفاصيل الاتهام' : 'تفاصيل البلاغ';

  try {
    const snap = await get(ref(db, 'reports/' + reportId));
    if (!snap.exists()) {
      content.innerHTML = '<p>البلاغ غير موجود</p>';
      return;
    }
    const r = snap.val();
    // إخفاء الملاحظات الداخلية عن غير الإدارة
    const showInternal = isAdmin;

    let html = `
      <div class="detail-box">
        <h3>${r.reportId}</h3>
        <div class="detail-row"><span class="status-badge ${statusClass(r.status)}">${r.status}</span></div>
        <div class="detail-row"><div class="detail-label">النوع</div>${typeLabel(r.type)}</div>
        <div class="detail-row"><div class="detail-label">تاريخ الإنشاء</div>${formatDate(r.createdAt)}</div>
        <div class="detail-row"><div class="detail-label">آخر تحديث</div>${formatDate(r.updatedAt)}</div>
    `;
    if (role === 'reporter' || isAdmin) {
      html += `<div class="detail-row"><div class="detail-label">أنت صاحب البلاغ</div></div>`;
    }
    if (role === 'accused') {
      html += `<div class="detail-row"><div class="detail-label">أنت المتهم في هذا البلاغ</div></div>`;
    }
    if (r.accusedName) html += `<div class="detail-row"><div class="detail-label">المتهم</div>${r.accusedName}</div>`;
    if (r.app) html += `<div class="detail-row"><div class="detail-label">التطبيق</div>${r.app}</div>`;
    if (r.section) html += `<div class="detail-row"><div class="detail-label">القسم</div>${r.section}</div>`;
    if (r.violationType) html += `<div class="detail-row"><div class="detail-label">نوع المخالفة</div>${r.violationType}</div>`;
    if (r.copyrightType) html += `<div class="detail-row"><div class="detail-label">نوع الانتهاك</div>${r.copyrightType}</div>`;
    if (r.description) html += `<div class="detail-row"><div class="detail-label">الوصف</div>${r.description}</div>`;
    if (r.link) html += `<div class="detail-row"><div class="detail-label">الرابط</div><a href="${r.link}" target="_blank">${r.link}</a></div>`;

    // الأدلة — الإدارة والمتهم (ما سمحت به الإدارة) وصاحب البلاغ
    const imgs = [];
    if (r.evidence) imgs.push(...(Array.isArray(r.evidence) ? r.evidence : [r.evidence]));
    if (r.image) imgs.push(r.image);
    if (r.contentImage) imgs.push(r.contentImage);
    if (r.originalImg) imgs.push(r.originalImg);
    if (r.copiedImg) imgs.push(r.copiedImg);
    if (r.proof) imgs.push(...(Array.isArray(r.proof) ? r.proof : [r.proof]));
    if (imgs.length && (isAdmin || role === 'reporter' || (role === 'accused' && r.showEvidenceToAccused !== false))) {
      html += `<div class="detail-row"><div class="detail-label">الأدلة</div>`;
      imgs.forEach(src => { if (src) html += `<img src="${src}" style="max-width:100%;border-radius:8px;margin:4px 0">`; });
      html += `</div>`;
    }

    // الطعون
    if (r.appeals && Object.keys(r.appeals).length) {
      html += `<div class="detail-row"><div class="detail-label">الطعون المقدمة</div>`;
      Object.values(r.appeals).forEach(a => {
        html += `<div style="background:#f5f5f5;padding:10px;border-radius:8px;margin:6px 0;font-size:13px">
          <div>${a.text}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${formatDate(a.at)}</div>
        </div>`;
      });
      html += `</div>`;
    }

    // سبب البطلان
    if (r.falseAccusationReason) {
      html += `<div class="detail-row"><div class="detail-label">سبب اعتبار الاتهام باطلًا</div>${r.falseAccusationReason}</div>`;
    }

    // ملاحظات داخلية للإدارة فقط
    if (showInternal && r.adminNotes) {
      html += `<div class="detail-row" style="background:#fff3e0;padding:10px;border-radius:8px"><div class="detail-label">ملاحظات داخلية</div>${r.adminNotes}</div>`;
    }

    // سجل الحالات
    if (r.statusHistory && r.statusHistory.length) {
      html += `<div class="detail-row"><div class="detail-label">سجل الحالات</div>`;
      r.statusHistory.forEach(h => {
        html += `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #eee">
          <strong>${h.status}</strong> — ${formatDate(h.at)}
          ${h.note ? `<br><span style="color:var(--text-secondary)">${h.note}</span>` : ''}
        </div>`;
      });
      html += `</div>`;
    }

    // معلومات الإصلاح الودي
    if (r.friendlyRoomId) {
      html += `<div class="detail-row"><div class="detail-label">غرفة إصلاح ودي</div>
        <button class="btn btn-secondary" style="margin-top:6px" onclick="window.openFriendlyChat('${r.friendlyRoomId}')">فتح الغرفة</button>
      </div>`;
    }

    html += `</div>`;
    content.innerHTML = html;

    // أزرار الإجراءات
    let actHtml = '';
    if (role === 'accused') {
      actHtml += `<button class="btn btn-primary btn-full" id="btn-appeal">الطعن في الاتهام</button>`;
      actHtml += `<button class="btn btn-secondary btn-full" id="btn-request-friendly">طلب إصلاح ودي</button>`;
    }
    if (isAdmin) {
      actHtml += `<button class="btn btn-primary btn-full" id="btn-change-status">تغيير الحالة</button>`;
      if (r.status === 'يجب عمل إصلاح ودي' || !r.friendlyRoomId) {
        actHtml += `<button class="btn btn-secondary btn-full" id="btn-admin-create-friendly">إنشاء غرفة إصلاح ودي</button>`;
      }
    }
    actions.innerHTML = actHtml;

    if ($('btn-appeal')) $('btn-appeal').addEventListener('click', () => show('appeal-modal'));
    if ($('btn-request-friendly')) {
      $('btn-request-friendly').addEventListener('click', async () => {
        await update(ref(db, 'reports/' + reportId), {
          friendlyRequested: true,
          updatedAt: Date.now()
        });
        toast('تم إرسال طلب الإصلاح الودي للإدارة', 'success');
      });
    }
    if ($('btn-change-status')) {
      $('btn-change-status').addEventListener('click', () => {
        $('new-status').value = r.status;
        show('status-modal');
      });
    }
    if ($('btn-admin-create-friendly')) {
      $('btn-admin-create-friendly').addEventListener('click', () => {
        $('friendly-report-id').value = reportId;
        $('friendly-accused-uid').value = r.accusedUid || '';
        $('friendly-reporter-uid').value = r.reporterUid || '';
        show('create-friendly-modal');
      });
    }
  } catch (e) {
    content.innerHTML = '<p style="color:var(--danger)">خطأ في التحميل</p>';
  }
}

// ===== الطعن =====
async function submitAppeal() {
  const text = $('appeal-text').value.trim();
  if (!text) { toast('اكتب ردك', 'error'); return; }
  if (!currentDetailReportId) return;
  let evidence = [];
  try {
    evidence = await filesToBase64($('appeal-evidence').files);
  } catch (e) { toast(e.message, 'error'); return; }

  const appealId = push(ref(db, 'reports/' + currentDetailReportId + '/appeals')).key;
  const appeal = {
    text,
    evidence,
    at: Date.now(),
    by: currentUser.uid,
    byName: currentUserData?.username || currentUser.email
  };
  await set(ref(db, 'reports/' + currentDetailReportId + '/appeals/' + appealId), appeal);
  await update(ref(db, 'reports/' + currentDetailReportId), {
    hasAppeal: true,
    updatedAt: Date.now()
  });
  // سجل
  await logAdminAction({
    action: 'appeal_submitted',
    reportId: currentDetailReportId,
    by: currentUser.uid,
    note: 'تم تقديم طعن'
  });
  hide('appeal-modal');
  $('appeal-text').value = '';
  toast('تم إرسال الطعن بنجاح', 'success');
  openReportDetail(currentDetailReportId, 'accused');
}

// ===== الشكر =====
async function loadThanks() {
  const list = $('thanks-list');
  const empty = $('no-thanks');
  list.innerHTML = '';
  try {
    const snap = await get(ref(db, 'thanks/' + currentUser.uid));
    if (!snap.exists()) {
      show(empty);
      return;
    }
    hide(empty);
    const items = [];
    snap.forEach(s => items.push({ id: s.key, ...s.val() }));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.map(t => `
      <div class="thanks-card">
        <div class="thanks-heart">❤️</div>
        <h3>شكرًا لك</h3>
        <div class="thanks-msg">"${t.message}"</div>
        <div style="font-size:13px;color:var(--text-secondary)">
          ${t.reason ? `<div>السبب: ${t.reason}</div>` : ''}
          ${t.app ? `<div>التطبيق: ${t.app}</div>` : ''}
          ${t.workDate ? `<div>تاريخ العمل: ${t.workDate}</div>` : ''}
          <div>${formatDate(t.createdAt)}</div>
        </div>
        ${t.image ? `<img src="${t.image}" alt="دليل">` : ''}
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

// ===== غرف الإصلاح =====
async function loadFriendlyRooms() {
  const list = $('friendly-rooms-list');
  const empty = $('no-friendly');
  list.innerHTML = '';
  try {
    const snap = await get(ref(db, 'friendlyRooms'));
    const items = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const room = s.val();
        if (room.accusedUid === currentUser.uid || room.reporterUid === currentUser.uid || room.adminUid === currentUser.uid) {
          items.push({ id: s.key, ...room });
        }
      });
    }
    if (items.length === 0) {
      show(empty);
      return;
    }
    hide(empty);
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.map(r => `
      <div class="report-card" data-room="${r.id}">
        <div class="report-card-header">
          <span class="report-id">${r.reportId || r.id}</span>
          <span class="status-badge ${r.status === 'active' ? 'status-قيد-المراجعة' : r.status === 'resolved' ? 'status-محلول' : ''}">${r.status === 'active' ? 'نشطة' : r.status === 'resolved' ? 'تم الحل' : r.status || '—'}</span>
        </div>
        <div class="report-meta">
          ${formatDate(r.createdAt)}
          ${r.duration ? `<br>المدة: ${r.duration === 0 ? 'أبدية' : r.duration + ' دقيقة'}` : ''}
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openFriendlyChat(card.dataset.room));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

window.openFriendlyChat = openFriendlyChat;

async function openFriendlyChat(roomId) {
  currentChatRoomId = roomId;
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  showPage('friendly-chat-page');
  $('chat-room-title').textContent = 'غرفة الإصلاح — ' + roomId.substring(0, 12);
  const messagesEl = $('chat-messages');
  messagesEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">جاري التحميل...</p>';

  const messagesRef = ref(db, 'friendlyMessages/' + roomId);
  chatUnsubscribe = onValue(messagesRef, (snap) => {
    messagesEl.innerHTML = '';
    if (!snap.exists()) {
      messagesEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary);font-size:13px">لا رسائل بعد — ابدأ الحوار</p>';
      return;
    }
    const msgs = [];
    snap.forEach(s => msgs.push({ id: s.key, ...s.val() }));
    msgs.sort((a, b) => (a.at || 0) - (b.at || 0));
    msgs.forEach(m => {
      const isMine = m.by === currentUser.uid;
      const isAdminMsg = m.role === 'admin';
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (isAdminMsg ? 'admin-msg' : isMine ? 'mine' : 'other');
      div.innerHTML = `
        <div>${m.text}</div>
        <div class="msg-meta">${m.byName || ''} · ${formatDate(m.at)}</div>
      `;
      messagesEl.appendChild(div);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

async function sendChatMessage() {
  const text = $('chat-input').value.trim();
  if (!text || !currentChatRoomId) return;
  const msg = {
    text,
    by: currentUser.uid,
    byName: currentUserData?.username || currentUser.email,
    role: isAdmin ? 'admin' : 'user',
    at: Date.now()
  };
  await push(ref(db, 'friendlyMessages/' + currentChatRoomId), msg);
  $('chat-input').value = '';
}

// ===== لوحة الإدارة =====
function loadAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
  const el = $('admin-tab-' + tab);
  if (el) el.classList.remove('hidden');
  if (tab === 'reports') loadAdminReports();
  else if (tab === 'accusations') loadAdminAccusations();
  else if (tab === 'friendly') loadAdminFriendly();
  else if (tab === 'thanks') loadAdminThanks();
  else if (tab === 'copyright') loadAdminCopyright();
  else if (tab === 'logs') loadAdminLogs();
}

async function loadAdminReports() {
  const list = $('admin-reports-list');
  list.innerHTML = '<p style="text-align:center">جاري التحميل...</p>';
  const typeFilter = $('admin-report-filter').value;
  const statusFilter = $('admin-status-filter').value;
  try {
    const snap = await get(ref(db, 'reports'));
    const items = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const r = s.val();
        if (typeFilter !== 'all' && r.type !== typeFilter) return;
        if (statusFilter !== 'all' && r.status !== statusFilter) return;
        items.push(r);
      });
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>لا توجد بلاغات</p></div>';
      return;
    }
    list.innerHTML = items.map(r => renderReportCard(r)).join('');
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openReportDetail(card.dataset.id, 'admin'));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ — تحقق من صلاحيات القراءة</p>';
  }
}

async function loadAdminAccusations() {
  const list = $('admin-accusations-list');
  list.innerHTML = '<p style="text-align:center">جاري التحميل...</p>';
  try {
    const snap = await get(ref(db, 'reports'));
    const items = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const r = s.val();
        if (r.accusedUid || r.accusedName) items.push(r);
      });
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.length ? items.map(r => renderReportCard(r)).join('') : '<div class="empty-state"><p>لا توجد اتهامات</p></div>';
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openReportDetail(card.dataset.id, 'admin'));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

async function loadAdminFriendly() {
  const list = $('admin-friendly-list');
  list.innerHTML = '<p style="text-align:center">جاري التحميل...</p>';
  try {
    const snap = await get(ref(db, 'friendlyRooms'));
    const items = [];
    if (snap.exists()) snap.forEach(s => items.push({ id: s.key, ...s.val() }));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.length ? items.map(r => `
      <div class="report-card" data-room="${r.id}">
        <div class="report-card-header">
          <span class="report-id">${r.reportId || r.id}</span>
          <span class="status-badge">${r.status || '—'}</span>
        </div>
        <div class="report-meta">${formatDate(r.createdAt)}</div>
      </div>
    `).join('') : '<div class="empty-state"><p>لا توجد غرف</p></div>';
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openFriendlyChat(card.dataset.room));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

async function loadAdminThanks() {
  const list = $('admin-thanks-list');
  list.innerHTML = '<p style="text-align:center">جاري التحميل...</p>';
  try {
    const snap = await get(ref(db, 'thanks'));
    const items = [];
    if (snap.exists()) {
      snap.forEach(userSnap => {
        userSnap.forEach(tSnap => {
          items.push({ userId: userSnap.key, id: tSnap.key, ...tSnap.val() });
        });
      });
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.length ? items.map(t => `
      <div class="report-card">
        <div class="report-card-header">
          <span class="report-id">${t.userName || t.userId}</span>
        </div>
        <div class="report-meta">${t.message}<br>${formatDate(t.createdAt)}</div>
      </div>
    `).join('') : '<div class="empty-state"><p>لا توجد رسائل شكر</p></div>';
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

async function loadAdminCopyright() {
  const list = $('admin-copyright-list');
  list.innerHTML = '<p style="text-align:center">جاري التحميل...</p>';
  try {
    const snap = await get(ref(db, 'reports'));
    const items = [];
    if (snap.exists()) {
      snap.forEach(s => {
        const r = s.val();
        if (r.type === 'copyright') items.push(r);
      });
    }
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    list.innerHTML = items.length ? items.map(r => renderReportCard(r)).join('') : '<div class="empty-state"><p>لا توجد بلاغات</p></div>';
    list.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => openReportDetail(card.dataset.id, 'admin'));
    });
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

async function loadAdminLogs() {
  const list = $('admin-logs-list');
  list.innerHTML = '<p style="text-align:center">جاري التحميل...</p>';
  try {
    const snap = await get(ref(db, 'adminActions'));
    const items = [];
    if (snap.exists()) snap.forEach(s => items.push({ id: s.key, ...s.val() }));
    items.sort((a, b) => (b.at || 0) - (a.at || 0));
    list.innerHTML = items.length ? items.slice(0, 100).map(l => `
      <div class="report-card">
        <div class="report-meta">
          <strong>${l.action}</strong> · ${l.reportId || '—'}
          <br>${formatDate(l.at)} · بواسطة: ${l.byName || l.by || '—'}
          ${l.note ? `<br>${l.note}` : ''}
          ${l.prevStatus ? `<br>${l.prevStatus} → ${l.newStatus}` : ''}
        </div>
      </div>
    `).join('') : '<div class="empty-state"><p>لا يوجد سجل</p></div>';
  } catch (e) {
    list.innerHTML = '<p style="color:var(--danger)">خطأ</p>';
  }
}

// ===== تغيير الحالة =====
async function confirmStatusChange() {
  if (!currentDetailReportId || !isAdmin) return;
  const newStatus = $('new-status').value;
  const note = $('status-note').value.trim();
  const falseReason = $('false-reason').value.trim();

  try {
    const snap = await get(ref(db, 'reports/' + currentDetailReportId));
    if (!snap.exists()) return;
    const r = snap.val();
    const prevStatus = r.status;
    const history = r.statusHistory || [];
    history.push({
      status: newStatus,
      at: Date.now(),
      by: currentUser.uid,
      byName: currentUserData?.username || currentUser.email,
      note
    });

    const updates = {
      status: newStatus,
      updatedAt: Date.now(),
      statusHistory: history
    };
    if (newStatus === 'اتهام باطل' && falseReason) {
      updates.falseAccusationReason = falseReason;
      updates.falseAccusationAt = Date.now();
      updates.falseAccusationBy = currentUser.uid;
    }
    if (note) updates.lastAdminNote = note;

    await update(ref(db, 'reports/' + currentDetailReportId), updates);

    // تحديث accusations
    if (r.accusedUid) {
      await update(ref(db, 'accusations/' + r.accusedUid + '/' + currentDetailReportId), {
        status: newStatus,
        updatedAt: Date.now()
      });
    }

    await logAdminAction({
      action: 'status_change',
      reportId: currentDetailReportId,
      by: currentUser.uid,
      byName: currentUserData?.username || currentUser.email,
      prevStatus,
      newStatus,
      note
    });

    hide('status-modal');
    toast('تم تحديث الحالة', 'success');
    openReportDetail(currentDetailReportId, 'admin');
  } catch (e) {
    toast('فشل التحديث: ' + e.message, 'error');
  }
}

// ===== إنشاء غرفة إصلاح =====
async function createFriendlyRoom() {
  if (!isAdmin) return;
  const reportId = $('friendly-report-id').value.trim();
  const accusedUid = $('friendly-accused-uid').value.trim();
  const reporterUid = $('friendly-reporter-uid').value.trim();
  const duration = parseInt($('friendly-duration').value) || 0;
  if (!reportId || !accusedUid || !reporterUid) {
    toast('أكمل الحقول المطلوبة', 'error');
    return;
  }
  try {
    const roomRef = push(ref(db, 'friendlyRooms'));
    const roomId = roomRef.key;
    const room = {
      reportId,
      accusedUid,
      reporterUid,
      adminUid: currentUser.uid,
      adminName: currentUserData?.username || currentUser.email,
      status: 'active',
      duration,
      createdAt: Date.now(),
      startsAt: Date.now()
    };
    await set(roomRef, room);
    await update(ref(db, 'reports/' + reportId), {
      friendlyRoomId: roomId,
      status: 'يجب عمل إصلاح ودي',
      updatedAt: Date.now()
    });
    // رسائل دعوة
    await push(ref(db, 'friendlyMessages/' + roomId), {
      text: 'تم إنشاء غرفة الإصلاح الودي. الإدارة والطرفان مدعوون للحوار بهدوء للوصول إلى حل.',
      by: currentUser.uid,
      byName: 'الإدارة',
      role: 'admin',
      at: Date.now()
    });
    await logAdminAction({
      action: 'create_friendly_room',
      reportId,
      by: currentUser.uid,
      note: 'غرفة: ' + roomId
    });
    hide('create-friendly-modal');
    toast('تم إنشاء غرفة الإصلاح الودي', 'success');
    loadAdminFriendly();
  } catch (e) {
    toast('فشل الإنشاء: ' + e.message, 'error');
  }
}

// ===== إنشاء شكر =====
async function createThanks() {
  if (!isAdmin) return;
  const userUid = $('thanks-user-uid').value.trim();
  const userName = $('thanks-user-name').value.trim();
  const app = $('thanks-app').value;
  const reason = $('thanks-reason').value.trim();
  const description = $('thanks-description').value.trim();
  const message = $('thanks-message').value.trim();
  const workDate = $('thanks-date').value;
  if (!userUid || !message || !reason) {
    toast('أكمل الحقول المطلوبة', 'error');
    return;
  }
  let image = null;
  if ($('thanks-image').files[0]) {
    try { image = await fileToBase64($('thanks-image').files[0]); }
    catch (e) { toast(e.message, 'error'); return; }
  }
  try {
    const thanksRef = push(ref(db, 'thanks/' + userUid));
    await set(thanksRef, {
      userUid,
      userName,
      app,
      reason,
      description,
      message,
      image,
      workDate,
      createdAt: Date.now(),
      by: currentUser.uid,
      byName: currentUserData?.username || currentUser.email
    });
    await logAdminAction({
      action: 'create_thanks',
      by: currentUser.uid,
      note: 'شكر لـ ' + userUid
    });
    hide('create-thanks-modal');
    toast('تم إرسال رسالة الشكر', 'success');
    loadAdminThanks();
  } catch (e) {
    toast('فشل: ' + e.message, 'error');
  }
}

// ===== سجل العمليات =====
async function logAdminAction(data) {
  try {
    await push(ref(db, 'adminActions'), {
      ...data,
      at: Date.now()
    });
  } catch (e) {
    console.error('logAdminAction', e);
  }
}

// تشغيل
init();
