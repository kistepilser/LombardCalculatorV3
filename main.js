/* ================================================================
   ЛОМБАРДНЫЙ ЭКСПЕРТ — main.js
   Логические блоки:
   1. CONFIG
   2. CRYPTO (PBKDF2 + SHA-256)
   3. STORAGE helpers
   4. AUTH (login/logout/session/admin bootstrap)
   5. ROLES & PERMISSIONS
   6. UI ROUTER (tabs/screens)
   7. OPERATION TABS sync
   8. CALCULATOR (original logic — untouched formulas)
   9. DEAL JOURNAL
   10. PREMIUM
   11. STATISTICS
   12. PLAN
   13. USER MANAGEMENT
================================================================ */
document.addEventListener('DOMContentLoaded', () => {

/* ================================================================
   1. CONFIG
================================================================ */
const ROLES = { ADMIN:'Администратор', SUBDIVISION:'Подразделение', MANAGER:'Управляющий', EXPERT:'Товаровед' };

const PREMIUM_RATE_BY_PURITY = { 375: 0.05, 500: 0.05, 583: 0.05, 585: 0.05, 750: 0.05 };

const STORAGE_KEYS = {
    USERS: 'le_users',
    SESSION: 'le_session',
    DEALS: 'le_deals',
    PLANS: 'le_plans',
    MANUAL_OPS: 'le_manual_ops'
};

const ADMIN_DEFAULT_LOGIN = 'admin';
const ADMIN_DEFAULT_PW = 'Xonahinelline2029';

/* ================================================================
   2. CRYPTO — Web Crypto API (PBKDF2, 150k iterations, SHA-256)
================================================================ */
function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { const s = atob(b64); const buf = new Uint8Array(s.length); for(let i=0;i<s.length;i++) buf[i]=s.charCodeAt(i); return buf.buffer; }

function generateSalt() { const salt = new Uint8Array(16); crypto.getRandomValues(salt); return bufToB64(salt.buffer); }

async function hashPassword(password, saltB64) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt: b64ToBuf(saltB64), iterations:150000, hash:'SHA-256' }, keyMat, 256);
    return bufToB64(bits);
}

async function verifyPassword(password, saltB64, hashB64) {
    const h = await hashPassword(password, saltB64);
    return h === hashB64;
}

/* ================================================================
   3. STORAGE helpers
================================================================ */
function getUsers() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS)) || []; } catch(e) { return []; } }
function saveUsers(arr) { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(arr)); }
function getSession() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION)); } catch(e) { return null; } }
function saveSession(s) { localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(STORAGE_KEYS.SESSION); }
function getDeals() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.DEALS)) || []; } catch(e) { return []; } }
function saveDeals(arr) { localStorage.setItem(STORAGE_KEYS.DEALS, JSON.stringify(arr)); }
function getPlans() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.PLANS)) || {}; } catch(e) { return {}; } }
function savePlans(obj) { localStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(obj)); }
function getManualOps() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.MANUAL_OPS)) || []; } catch(e) { return []; } }
function saveManualOps(arr) { localStorage.setItem(STORAGE_KEYS.MANUAL_OPS, JSON.stringify(arr)); }

/* ================================================================
   4. AUTH
================================================================ */
let currentUser = null;

async function bootstrapAdmin() {
    const users = getUsers();
    if (users.length > 0) return;
    const salt = generateSalt();
    const hash = await hashPassword(ADMIN_DEFAULT_PW, salt);
    const admin = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'admin-' + Date.now(),
        login: ADMIN_DEFAULT_LOGIN,
        role: ROLES.ADMIN,
        passwordHash: hash,
        salt: salt,
        createdAt: new Date().toISOString(),
        mustChangePassword: true,
        createdBy: 'system'
    };
    saveUsers([admin]);
}

function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-wrapper').classList.add('hidden');
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-username').focus();
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-wrapper').classList.remove('hidden');
    applyRoleUI();
    switchTab('zalog-no-ins');
    updatePremiumBadge();
}

async function doLogin() {
    const login = document.getElementById('login-username').value.trim();
    const pw = document.getElementById('login-password').value;
    if (!login || !pw) { document.getElementById('login-error').textContent = 'Введите логин и пароль'; return; }
    const users = getUsers();
    const user = users.find(u => u.login === login);
    if (!user) { document.getElementById('login-error').textContent = 'Неверный логин или пароль'; return; }
    const ok = await verifyPassword(pw, user.salt, user.passwordHash);
    if (!ok) { document.getElementById('login-error').textContent = 'Неверный логин или пароль'; return; }
    currentUser = user;
    saveSession({ userId: user.id, login: user.login, role: user.role, loginAt: new Date().toISOString() });
    if (user.mustChangePassword) {
        showApp();
        openChangePw(true);
    } else {
        showApp();
    }
}

function doLogout() { clearSession(); currentUser = null; showLogin(); }

async function tryAutoLogin() {
    const sess = getSession();
    if (!sess) { showLogin(); return; }
    const users = getUsers();
    const user = users.find(u => u.id === sess.userId);
    if (!user) { clearSession(); showLogin(); return; }
    currentUser = user;
    showApp();
    if (user.mustChangePassword) openChangePw(true);
}

/* ================================================================
   5. ROLES & PERMISSIONS
================================================================ */
const ROLE_ICONS = {};
ROLE_ICONS[ROLES.ADMIN] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
ROLE_ICONS[ROLES.SUBDIVISION] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="12" y1="10" x2="12" y2="22"/></svg>';
ROLE_ICONS[ROLES.MANAGER] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>';
ROLE_ICONS[ROLES.EXPERT] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 2 8 12 22 22 8"/><line x1="2" y1="8" x2="22" y2="8"/></svg>';

function canManageUsers(role) { return role===ROLES.ADMIN||role===ROLES.SUBDIVISION||role===ROLES.MANAGER; }
function canSetPlan(role) { return role===ROLES.ADMIN||role===ROLES.SUBDIVISION||role===ROLES.MANAGER; }
function canEarnPremium(role) { return role===ROLES.EXPERT||role===ROLES.MANAGER; }
function creatableRoles(role) {
    if (role===ROLES.ADMIN) return [ROLES.ADMIN,ROLES.SUBDIVISION,ROLES.MANAGER,ROLES.EXPERT];
    if (role===ROLES.SUBDIVISION) return [ROLES.MANAGER,ROLES.EXPERT];
    if (role===ROLES.MANAGER) return [ROLES.EXPERT];
    return [];
}

function applyRoleUI() {
    if (!currentUser) return;
    document.getElementById('profile-name').textContent = currentUser.login;
    document.getElementById('profile-icon').innerHTML = ROLE_ICONS[currentUser.role] || ROLE_ICONS[ROLES.EXPERT];
    const canManage = canManageUsers(currentUser.role);
    document.getElementById('btn-manage-users').classList.toggle('hidden', !canManage);
    const canPremium = canEarnPremium(currentUser.role);
    document.getElementById('premium-badge').classList.toggle('hidden', !canPremium);
}

/* ================================================================
   6. UI ROUTER — Tabs / Screens
================================================================ */
let activeTab = 'zalog-no-ins';

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.header-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const isStats = (tab === 'stats');
    document.getElementById('screen-calc').classList.toggle('hidden', isStats);
    document.getElementById('screen-stats').classList.toggle('hidden', !isStats);
    if (isStats) { refreshStats(); refreshPlan(); return; }
    syncOperationMode(tab);
}

/* ================================================================
   7. OPERATION TABS sync
================================================================ */
function syncOperationMode(tab) {
    const buyoutSwitch = document.getElementById('isBuyout');
    const insSwitch = document.getElementById('isInsured');
    const insContainer = document.getElementById('ins-container');
    if (tab === 'zalog-no-ins') {
        buyoutSwitch.checked = false;
        insSwitch.checked = false;
        insContainer.style.pointerEvents = 'none';
        insContainer.style.opacity = '0.6';
        document.getElementById('ins-status').innerText = 'Отключена (заблокировано)';
    } else if (tab === 'zalog-ins') {
        buyoutSwitch.checked = false;
        insSwitch.checked = true;
        insContainer.style.pointerEvents = 'none';
        insContainer.style.opacity = '0.6';
        document.getElementById('ins-status').innerText = 'Включена (заблокировано)';
    } else if (tab === 'skupka') {
        buyoutSwitch.checked = true;
        insSwitch.checked = true;
        insContainer.style.pointerEvents = 'none';
        insContainer.style.opacity = '0.6';
        document.getElementById('ins-status').innerText = 'Обязательно (Скупка)';
    }
    calculate();
}

/* ================================================================
   8. CALCULATOR — Original logic (formulas untouched)
================================================================ */
document.querySelectorAll('input[type="number"]').forEach(inp => { inp.setAttribute('type','text'); inp.setAttribute('inputmode','decimal'); });
const parseVal = val => parseFloat(val.toString().replace(',','.')) || 0;

const SVGS = {
    arrow: `<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
    types: {
        'fianite': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 2 8 12 22 22 8 12 2"/><line x1="2" y1="8" x2="22" y2="8"/></svg>`,
        'diamond': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 2 8 12 22 22 8 12 2"/><line x1="2" y1="8" x2="22" y2="8"/><polyline points="12 2 12 22"/><polyline points="12 2 6 8 12 22"/><polyline points="12 2 18 8 12 22"/></svg>`,
        'amber': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 7.477 2 13s4.477 9 10 9z"/></svg>`,
        'pearl': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg>`,
        'enamel': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22C6.477 22 2 17.523 2 12c0-4.418 4.25-9.633 8.35-13.8a2.5 2.5 0 0 1 3.3 0C17.75 2.367 22 7.582 22 12c0 5.523-4.477 10-10 10z"/></svg>`
    },
    shapes: {
        'krug': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/></svg>`,
        'oval': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="12" rx="6" ry="10"/></svg>`,
        'baget': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="3" width="10" height="18" rx="1"/></svg>`,
        'kvadrat': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>`,
        'markiz': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C18 8 18 16 12 22C6 16 6 8 12 2Z"/></svg>`,
        'grusha': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C12 2 6 10 6 15A6 6 0 0 0 18 15C18 10 12 2 12 2Z"/></svg>`,
        'oktagon': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="8 3 16 3 21 8 21 16 16 21 8 21 3 16 3 8"/></svg>`,
        'serdtse': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
        'treugolnik': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 3 3 20 21 20"/></svg>`,
        'trillion': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3C15 9 21 19 21 19C16 21 8 21 3 19C3 19 9 9 12 3Z"/></svg>`,
        'shar': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/></svg>`
    },
    names: { 'fianite':'Фианит','diamond':'Бриллиант','amber':'Янтарь','pearl':'Жемчуг','enamel':'Эмаль','krug':'Круг','oval':'Овал','baget':'Багет','kvadrat':'Квадрат','markiz':'Маркиз','grusha':'Груша','oktagon':'Октагон','serdtse':'Сердце','treugolnik':'Треугольник','trillion':'Триллион','shar':'Шар' }
};

const stoneCoeffs = { 'krug':0.0135,'baget':0.02175,'grusha':0.013125,'kvadrat':0.01725,'markiz':0.012,'oval':0.015,'oktagon':0.018375,'serdtse':0.01575,'treugolnik':0.0135,'trillion':0.01275,'shar':0.019425 };
const BASE_SELLING_PRICE = 6500;
let currentLoanTotal = 0;
let lastCalcData = {};

const targetDateInput = document.getElementById('targetDate');
const today = new Date(); today.setHours(0,0,0,0);
const pad = n => String(n).padStart(2,'0');
if (targetDateInput) {
    targetDateInput.min = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
    const defDate = new Date(); defDate.setDate(defDate.getDate()+31);
    targetDateInput.value = `${defDate.getFullYear()}-${pad(defDate.getMonth()+1)}-${pad(defDate.getDate())}`;
}

function calculate() {
    const totalWeightEl = document.getElementById('totalWeight');
    const totalW = totalWeightEl ? parseVal(totalWeightEl.value) : 0;
    const isHollow = document.getElementById('isHollow').checked;
    const isBuyout = document.getElementById('isBuyout').checked;
    const insSwitch = document.getElementById('isInsured');
    const purityEl = document.querySelector('input[name="purity"]:checked');
    const purity = purityEl ? parseFloat(purityEl.value) : 585;
    const itemTypeEl = document.querySelector('input[name="itemType"]:checked');
    const itemDeduct = itemTypeEl ? parseFloat(itemTypeEl.value) : 0.1;

    if (isBuyout) {
        document.getElementById('op-status').innerText = "Скупка";
        document.getElementById('price-group-zalog').style.display = 'none';
        document.getElementById('price-group-skupka').style.display = 'flex';
        document.getElementById('margin-block').style.display = 'block';
        document.getElementById('interest-block').style.display = 'none';
        document.getElementById('lbl-price-group').innerText = 'Тариф за грамм (Скупка)';
    } else {
        document.getElementById('op-status').innerText = "Залог";
        document.getElementById('price-group-zalog').style.display = 'flex';
        document.getElementById('price-group-skupka').style.display = 'none';
        document.getElementById('margin-block').style.display = 'none';
        document.getElementById('interest-block').style.display = 'block';
        document.getElementById('lbl-price-group').innerText = 'Тариф за грамм (Залог)';
    }

    const isInsured = insSwitch.checked;

    document.querySelectorAll('.radio-label input[name^="price_"]').forEach(radio => {
        const base = parseFloat(radio.value);
        const calc = Math.round(base * (purity/585));
        const btn = radio.nextElementSibling;
        if(btn && btn.querySelector('.calc-val')) {
            btn.querySelector('.calc-val').innerText = calc.toLocaleString('ru-RU') + ' ₽';
            btn.querySelector('.base-val').innerText = '(' + base.toLocaleString('ru-RU') + ' ₽)';
        }
    });

    let stonesGramsTotal = 0;
    let cartHTML = '';
    if (totalW > 0) {
        if (itemDeduct === 0.1) { cartHTML += `<div class="cart-item"><span class="item-name">Загрязнение х1</span><span class="dots"></span><span class="item-val">-0.100 г</span></div>`; }
        else if (itemDeduct === 0.15) { cartHTML += `<div class="cart-item"><span class="item-name">Загрязнение х1</span><span class="dots"></span><span class="item-val">-0.100 г</span></div>`; cartHTML += `<div class="cart-item"><span class="item-name">Замок х1</span><span class="dots"></span><span class="item-val">-0.050 г</span></div>`; }
    }

    document.querySelectorAll('.stone-row').forEach(row => {
        const type = row.querySelector('.val-t').value;
        const shape = row.querySelector('.val-shape').value;
        const summaryTextEl = row.querySelector('.summary-text');
        const lInput = row.querySelector('.s-l'); const wInput = row.querySelector('.s-w');
        const hInput = row.querySelector('.s-h'); const qtyInput = row.querySelector('.s-q');
        const L = parseVal(lInput.value); const W = parseVal(wInput.value)||L;
        const H = parseVal(hInput.value)||(W*0.6); const Q = parseInt(qtyInput.value)||1;
        let iconSVG = SVGS.types[type]||SVGS.types.fianite;
        if(type!=='enamel'&&type!=='pearl'&&type!=='amber') iconSVG = SVGS.shapes[shape]||iconSVG;
        if (L > 0) {
            let gram=0, ct=0;
            if (type==='enamel') { gram=(L*W/100)*0.1*Q; }
            else if (type==='pearl') { ct=Math.pow(L,3)*0.01295*Q; gram=ct*0.2; }
            else if (type==='amber') { ct=L*W*H*0.0065*Q; gram=ct*0.2; }
            else { ct=L*W*H*(stoneCoeffs[shape]||0.0135); if(type==='diamond') ct*=(0.0037/0.0081); ct*=Q; gram=ct*0.2; }
            stonesGramsTotal += gram;
            const displayName = SVGS.names[type]+(type==='enamel'||type==='pearl'||type==='amber'?'':' '+SVGS.names[shape]);
            summaryTextEl.innerHTML = `<span class="summary-icon">${iconSVG}</span><span style="color:var(--text-main);margin-left:4px;">${displayName}</span><span class="badge-qty">${Q} шт</span><div class="summary-result"><b style="color:var(--danger);">-${gram.toFixed(3)} г</b>${ct>0?`<span style="color:var(--text-secondary);font-size:11px;">(${ct.toFixed(2)} ct)</span>`:''}</div>`;
            if (totalW > 0) cartHTML += `<div class="cart-item"><span class="item-name">${displayName} x${Q}</span><span class="dots"></span><span class="item-val">-${gram.toFixed(3)} г</span></div>`;
        } else {
            summaryTextEl.innerHTML = `<span class="summary-icon">${iconSVG}</span><span style="margin-left:8px;color:var(--text-secondary);">Вставка (нажмите для ввода)</span>`;
        }
    });

    if (totalW > 0) {
        if (isHollow) { const hd=totalW*0.05; stonesGramsTotal+=hd; cartHTML+=`<div class="cart-item"><span class="item-name">Пустотелость (5%)</span><span class="dots"></span><span class="item-val">-${hd.toFixed(3)} г</span></div>`; }
        if (totalW > 20) { const hv=totalW*0.005; stonesGramsTotal+=hv; cartHTML+=`<div class="cart-item"><span class="item-name">Свыше 20г (0.5%)</span><span class="dots"></span><span class="item-val">-${hv.toFixed(3)} г</span></div>`; }
        // Штифты
        const hasPins = document.getElementById('hasPins') && document.getElementById('hasPins').checked;
        if (hasPins) {
            const pinsQty = parseInt(document.getElementById('pinsQty').value) || 1;
            const pinsGrams = pinsQty * 0.1;
            stonesGramsTotal += pinsGrams;
            cartHTML += `<div class="cart-item"><span class="item-name">Штифты x${pinsQty}</span><span class="dots"></span><span class="item-val">-${pinsGrams.toFixed(3)} г</span></div>`;
        }
    }

    const netW = Math.max(0, totalW - itemDeduct - stonesGramsTotal);
    document.getElementById('netWeight').value = netW.toFixed(3);
    if (totalW > 0) { document.getElementById('cart-container').style.display='block'; document.getElementById('cart-items').innerHTML=cartHTML; document.getElementById('cart-net-weight').innerText=netW.toFixed(3)+' г'; }
    else { document.getElementById('cart-container').style.display='none'; }

    const btn7000 = document.getElementById('btn7000');
    let selectedBase = 0;
    if (isBuyout) {
        const radio = document.querySelector('input[name="price_skupka"]:checked');
        if(radio) selectedBase = parseFloat(radio.value);
        if(btn7000) btn7000.disabled = false;
        document.getElementById('limitMsg').style.display = 'none';
    } else {
        const checkPrice = isInsured ? 7000 : 6300;
        const checkTotal = Math.round(netW * Math.round(checkPrice * (purity/585)));
        if (checkTotal > 150000) {
            if(btn7000) btn7000.disabled = true;
            document.getElementById('limitMsg').style.display = 'flex';
            if (btn7000 && btn7000.checked) { const btn6k = document.querySelector('input[name="price_zalog"][value="6000"]'); if(btn6k) btn6k.checked = true; }
        } else { if(btn7000) btn7000.disabled = false; document.getElementById('limitMsg').style.display = 'none'; }
        const radio = document.querySelector('input[name="price_zalog"]:checked');
        if(radio) selectedBase = parseFloat(radio.value);
    }

    const actualPrice = Math.round(selectedBase * (purity/585));
    const amountHand = Math.round(netW * actualPrice);
    document.getElementById('res-base-price').innerText = selectedBase.toLocaleString('ru-RU')+' ₽';
    document.getElementById('res-actual-price').innerText = actualPrice.toLocaleString('ru-RU')+' ₽';
    document.getElementById('res-purity-label').innerText = purity;

    let insuranceSum = 0;
    let marginSum = 0;

    if (isBuyout) {
        marginSum = Math.round((Math.round(BASE_SELLING_PRICE*(purity/585))-actualPrice)*netW);
        document.getElementById('res-margin').innerText = marginSum.toLocaleString('ru-RU')+' ₽';
    }

    if (isInsured) {
        document.getElementById('insurance-blocks').style.display = 'block';
        insuranceSum = Math.round(amountHand * 0.2376);
        currentLoanTotal = amountHand + insuranceSum;
        document.getElementById('res-hand').innerText = amountHand.toLocaleString('ru-RU')+' ₽';
        document.getElementById('res-ins').innerText = insuranceSum.toLocaleString('ru-RU')+' ₽';
    } else {
        document.getElementById('insurance-blocks').style.display = 'none';
        currentLoanTotal = amountHand;
    }

    // Split display: На руки (always) + Сумма займа (only for pledge)
    document.getElementById('res-hand-main').innerText = amountHand.toLocaleString('ru-RU')+' ₽';
    if (isBuyout) {
        document.getElementById('loan-total-box').style.display = 'none';
        document.getElementById('res-total').innerText = amountHand.toLocaleString('ru-RU')+' ₽';
    } else {
        document.getElementById('loan-total-box').style.display = '';
        document.getElementById('res-total').innerText = currentLoanTotal.toLocaleString('ru-RU')+' ₽';
    }

    lastCalcData = {
        purity, netWeight: netW, actualPrice, selectedBase,
        amountHand, insuranceSum, marginSum, loanTotal: currentLoanTotal,
        isBuyout, isInsured,
        operationType: isBuyout ? 'Скупка' : (isInsured ? 'Залог со страхованием' : 'Залог без страхования')
    };

    updateInterest();
}

function updateInterest() {
    if (document.getElementById('isBuyout').checked || currentLoanTotal===0 || !targetDateInput) {
        document.getElementById('int-days').innerText="0"; document.getElementById('int-percent').innerText="0.000%";
        document.getElementById('int-sum').innerText="0 ₽"; document.getElementById('int-total-return').innerText="0 ₽"; return;
    }
    const tDate = new Date(targetDateInput.value); tDate.setHours(0,0,0,0);
    const diffTime = tDate.getTime()-today.getTime();
    let days = Math.floor(diffTime/(1000*3600*24))+1; if(days<1) days=1;
    let rate=0;
    if(days>1) rate+=Math.min(days-1,5)*0.402;
    if(days>6) rate+=Math.min(days-6,17)*0.128;
    if(days>23) rate+=(days-23)*0.578;
    const sum = Math.round(currentLoanTotal*(rate/100));
    document.getElementById('int-days').innerText=days;
    document.getElementById('int-percent').innerText=rate.toFixed(3)+'%';
    document.getElementById('int-sum').innerText=sum.toLocaleString('ru-RU')+' ₽';
    document.getElementById('int-total-return').innerText=(currentLoanTotal+sum).toLocaleString('ru-RU')+' ₽';
}

/* ================================================================
   9. DEAL JOURNAL
================================================================ */
function saveDeal() {
    if (!currentUser || lastCalcData.amountHand <= 0) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const purity = lastCalcData.purity;
    let premiumSum = 0;
    let premiumBreakdown = {};
    if (canEarnPremium(currentUser.role)) {
        const threshold = Math.round(2500 * (purity / 585));
        if (lastCalcData.amountHand >= threshold) {
            const rate = PREMIUM_RATE_BY_PURITY[purity] || 0.015;
            premiumSum = Math.round(lastCalcData.amountHand * rate);
            premiumBreakdown[purity] = premiumSum;
        }
    }
    const deal = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        date: dateStr,
        timestamp: now.toISOString(),
        userId: currentUser.id,
        userLogin: currentUser.login,
        role: currentUser.role,
        operationType: lastCalcData.operationType,
        insured: lastCalcData.isInsured,
        isBuyout: lastCalcData.isBuyout,
        amountHand: lastCalcData.amountHand,
        loanTotal: lastCalcData.loanTotal,
        insuranceSum: lastCalcData.insuranceSum || 0,
        marginSum: lastCalcData.marginSum || 0,
        purity: purity,
        netWeight: lastCalcData.netWeight,
        actualPrice: lastCalcData.actualPrice,
        premiumSum: premiumSum,
        premiumBreakdown: premiumBreakdown
    };
    const deals = getDeals();
    deals.push(deal);
    saveDeals(deals);
    updatePremiumBadge();
    showDealFeedback(true);
}

function showDealFeedback(saved) {
    const section = document.getElementById('deal-section');
    const msg = saved ? '✅ Сделка сохранена' : '❌ Сделка отклонена';
    const color = saved ? 'var(--success)' : 'var(--danger)';
    const oldH3 = section.querySelector('h3');
    const oldHTML = oldH3.innerHTML;
    oldH3.innerHTML = `<span style="color:${color};font-size:15px;">${msg}</span>`;
    setTimeout(() => { oldH3.innerHTML = oldHTML; }, 2000);
}

/* ================================================================
   10. PREMIUM
================================================================ */
function calcSessionPremium() {
    if (!currentUser || !canEarnPremium(currentUser.role)) return { total:0, byPurity:{} };
    const deals = getDeals();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
    const bp = { 375:0, 500:0, 583:0, 585:0, 750:0 };
    let total = 0;
    deals.forEach(d => {
        if (d.userId === currentUser.id && d.date.startsWith(monthKey) && d.premiumSum > 0) {
            total += d.premiumSum;
            const p = d.purity;
            if (bp[p] !== undefined) bp[p] += d.premiumSum;
        }
    });
    return { total, byPurity: bp };
}

function updatePremiumBadge() {
    if (!currentUser || !canEarnPremium(currentUser.role)) return;
    const { total } = calcSessionPremium();
    document.getElementById('premium-badge-sum').textContent = total.toLocaleString('ru-RU') + ' ₽';
}

function showPremiumModal() {
    const { total, byPurity } = calcSessionPremium();
    const container = document.getElementById('premium-breakdown');
    const purities = [375, 500, 583, 585, 750];
    container.innerHTML = purities.map(p => `<div class="premium-row"><span class="purity-label">${p} проба</span><span class="purity-value">${(byPurity[p]||0).toLocaleString('ru-RU')} ₽</span></div>`).join('');
    document.getElementById('premium-modal-total').textContent = total.toLocaleString('ru-RU') + ' ₽';
    document.getElementById('premium-overlay').classList.add('active');
}

/* ================================================================
   11. STATISTICS
================================================================ */
const MONTH_NAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function initStatsPeriod() {
    const deals = getDeals();
    const years = new Set();
    deals.forEach(d => { if (d.date) years.add(d.date.substring(0,4)); });
    const now = new Date();
    years.add(String(now.getFullYear()));
    const yearArr = [...years].sort().reverse();
    const yearSel = document.getElementById('stats-year');
    yearSel.innerHTML = yearArr.map(y => `<option value="${y}"${y===String(now.getFullYear())?' selected':''}>${y}</option>`).join('');
    renderMonthButtons();
    yearSel.onchange = () => renderMonthButtons();
}

function renderMonthButtons() {
    const year = document.getElementById('stats-year').value;
    const container = document.getElementById('stats-months');
    const now = new Date();
    const curMonth = now.getFullYear() === parseInt(year) ? now.getMonth() : -1;
    container.innerHTML = MONTH_NAMES_SHORT.map((m, i) => {
        const mn = String(i+1).padStart(2,'0');
        const isActive = i === curMonth;
        return `<button class="btn-skeuo month-btn${isActive?' active-month':''}" data-month="${year}-${mn}" style="padding:6px 10px;font-size:12px;font-weight:700;">${m}</button>`;
    }).join('');
    container.querySelectorAll('.month-btn').forEach(btn => {
        btn.onclick = () => {
            const ym = btn.dataset.month;
            const y = parseInt(ym.split('-')[0]);
            const m = parseInt(ym.split('-')[1]);
            const lastDay = new Date(y, m, 0).getDate();
            document.getElementById('stats-date-from').value = `${ym}-01`;
            document.getElementById('stats-date-to').value = `${ym}-${String(lastDay).padStart(2,'0')}`;
            container.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active-month'));
            btn.classList.add('active-month');
            refreshStats();
        };
    });
}

/* --- Custom Confirm Modal (replaces native confirm) --- */
function showConfirm(msg) {
    return new Promise(resolve => {
        const overlay = document.getElementById('confirm-overlay');
        document.getElementById('confirm-message').textContent = msg;
        overlay.style.display = 'flex';
        function cleanup(result) {
            overlay.style.display = 'none';
            document.getElementById('confirm-ok').onclick = null;
            document.getElementById('confirm-cancel').onclick = null;
            resolve(result);
        }
        document.getElementById('confirm-ok').onclick = () => cleanup(true);
        document.getElementById('confirm-cancel').onclick = () => cleanup(false);
    });
}

async function deleteDeal(dealId) {
    if (!currentUser || currentUser.role !== 'Администратор') return;
    const ok = await showConfirm('Удалить сделку? Это действие нельзя отменить.');
    if (!ok) return;
    const deals = getDeals().filter(d => d.id !== dealId);
    saveDeals(deals);
    refreshStats();
    refreshPlan();
}

async function deleteManualOp(opId) {
    if (!currentUser || currentUser.role !== 'Администратор') return;
    const ok = await showConfirm('Удалить операцию? Это действие нельзя отменить.');
    if (!ok) return;
    const ops = getManualOps().filter(o => o.id !== opId);
    saveManualOps(ops);
    renderManualLogs();
    refreshStats();
    refreshPlan();
}

/* Global event delegation for delete buttons */
document.body.addEventListener('click', function(e) {
    const dealBtn = e.target.closest('[data-delete-deal]');
    if (dealBtn) {
        e.preventDefault();
        e.stopPropagation();
        deleteDeal(dealBtn.getAttribute('data-delete-deal'));
        return;
    }
    const opBtn = e.target.closest('[data-delete-op]');
    if (opBtn) {
        e.preventDefault();
        e.stopPropagation();
        deleteManualOp(opBtn.getAttribute('data-delete-op'));
        return;
    }
});

function refreshStats() {
    const from = document.getElementById('stats-date-from').value;
    const to = document.getElementById('stats-date-to').value;
    const deals = getDeals().filter(d => {
        if (from && d.date < from) return false;
        if (to && d.date > to) return false;
        return true;
    });
    const manualOps = getManualOps().filter(m => {
        if (from && m.date < from) return false;
        if (to && m.date > to) return false;
        return true;
    });
    let totals = { count:0, hand:0, loan:0, ins:0, margin:0, premium:0, returns:0, extensions:0 };
    const byDay = {};
    deals.forEach(d => {
        totals.count++;
        totals.hand += d.amountHand || 0;
        totals.loan += d.loanTotal || 0;
        totals.ins += d.insuranceSum || 0;
        totals.margin += d.marginSum || 0;
        totals.premium += d.premiumSum || 0;
        if (!byDay[d.date]) byDay[d.date] = { count:0, hand:0, loan:0, ins:0, margin:0, premium:0 };
        byDay[d.date].count++;
        byDay[d.date].hand += d.amountHand || 0;
        byDay[d.date].loan += d.loanTotal || 0;
        byDay[d.date].ins += d.insuranceSum || 0;
        byDay[d.date].margin += d.marginSum || 0;
        byDay[d.date].premium += d.premiumSum || 0;
    });
    // Manual ops totals
    manualOps.forEach(m => {
        if (m.type === 'return') totals.returns += m.totalSum || 0;
        if (m.type === 'extension') totals.extensions += m.totalSum || 0;
    });
    const fmt = n => n.toLocaleString('ru-RU');
    document.getElementById('sc-total-deals').textContent = totals.count;
    document.getElementById('sc-total-hand').textContent = fmt(totals.hand)+' ₽';
    document.getElementById('sc-total-loan').textContent = fmt(totals.loan)+' ₽';
    document.getElementById('sc-total-ins').textContent = fmt(totals.ins)+' ₽';
    document.getElementById('sc-total-margin').textContent = fmt(totals.margin)+' ₽';
    document.getElementById('sc-total-premium').textContent = fmt(totals.premium)+' ₽';
    document.getElementById('sc-total-returns').textContent = fmt(totals.returns)+' ₽';
    document.getElementById('sc-total-extensions').textContent = fmt(totals.extensions)+' ₽';

    const tbody = document.getElementById('stats-tbody');
    const days = Object.keys(byDay).sort().reverse();
    if (days.length === 0) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:24px;">Нет данных за выбранный период</td></tr>'; }
    else {
        tbody.innerHTML = days.map(day => {
            const r = byDay[day];
            return `<tr><td>${day}</td><td>${r.count}</td><td>${fmt(r.hand)} ₽</td><td>${fmt(r.loan)} ₽</td><td>${fmt(r.ins)} ₽</td><td>${fmt(r.margin)} ₽</td><td>${fmt(r.premium)} ₽</td></tr>`;
        }).join('');
    }
    renderDealsDetail(deals);
    renderManualLogs();
}

/* ================================================================
   11a. DEAL DETAIL — TABBED BY SUBDIVISION, HIERARCHY INSIDE
================================================================ */
function renderDealsDetail(deals) {
    const tabsContainer = document.getElementById('detail-tabs');
    const contentContainer = document.getElementById('deals-detail');
    if (!deals || deals.length === 0) {
        tabsContainer.innerHTML = '';
        contentContainer.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:30px;">Нет сделок за выбранный период</div>';
        return;
    }
    // Group by subdivision (user login who belongs to a subdivision)
    // We use the deal's subdivision field if present, otherwise group by role
    const users = getUsers();
    const userSubMap = {};
    users.forEach(u => { userSubMap[u.login] = u.subdivision || u.role || 'Общее'; });

    const bySub = {};
    deals.forEach(d => {
        const sub = userSubMap[d.userLogin] || d.role || 'Общее';
        if (!bySub[sub]) bySub[sub] = [];
        bySub[sub].push(d);
    });

    const subKeys = Object.keys(bySub);
    // Render tabs
    tabsContainer.innerHTML = subKeys.map((sub, i) =>
        `<button class="side-tab${i===0?' active':''}" data-detail-tab="${sub}">${sub} (${bySub[sub].length})</button>`
    ).join('');

    // Render first tab content
    function renderSubContent(subName) {
        const subDeals = bySub[subName] || [];
        // Group by role hierarchy: Управляющие, Товароведы, other
        const ROLE_ORDER = ['Управляющий', 'Товаровед', 'Администратор', 'Подразделение'];
        const byRole = {};
        subDeals.forEach(d => {
            const role = d.role || 'Другое';
            if (!byRole[role]) byRole[role] = {};
            const login = d.userLogin || 'unknown';
            if (!byRole[role][login]) byRole[role][login] = [];
            byRole[role][login].push(d);
        });
        const roleLabelMap = {
            'Управляющий': 'Управляющие',
            'Товаровед': 'Товароведы',
            'Администратор': 'Администраторы',
            'Подразделение': 'Подразделение'
        };
        const roleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        const fmt = n => (n||0).toLocaleString('ru-RU');
        let html = '';
        const sortedRoles = Object.keys(byRole).sort((a,b) => {
            const ia = ROLE_ORDER.indexOf(a); const ib = ROLE_ORDER.indexOf(b);
            return (ia===-1?99:ia) - (ib===-1?99:ib);
        });
        for (const role of sortedRoles) {
            const roleLabel = roleLabelMap[role] || role;
            html += `<div class="role-block">`;
            html += `<div class="role-block-header">${roleIcon} ${roleLabel}</div>`;
            for (const login of Object.keys(byRole[role])) {
                const userDeals = byRole[role][login];
                html += `<div class="detail-user-section open">`;
                html += `<div class="detail-user-header" onclick="this.parentElement.classList.toggle('open')">`;
                html += `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> ${login} (${userDeals.length})`;
                html += `</div><div class="detail-user-deals">`;
                userDeals.forEach(d => {
                    const time = d.timestamp ? d.timestamp.split('T')[1].substring(0,5) : '';
                    const isAdmin = currentUser && currentUser.role === 'Администратор';
                    html += `<div class="detail-deal-item">`;
                    html += `<span class="deal-time">${d.date} ${time}</span>`;
                    html += `<span class="deal-type">${d.operationType||'-'}</span>`;
                    html += `<span class="deal-sum">${fmt(d.amountHand)} ₽</span>`;
                    html += `<span>Страх: ${fmt(d.insuranceSum)} ₽</span>`;
                    html += `<span>Маржа: ${fmt(d.marginSum)} ₽</span>`;
                    html += `<span>${d.purity} пр. / ${(d.netWeight||0).toFixed(2)} г</span>`;
                    if (isAdmin) {
                        html += `<button class="deal-delete-btn" data-delete-deal="${d.id}" title="Удалить сделку">🗑</button>`;
                    }
                    html += `</div>`;
                });
                html += `</div></div>`;
            }
            html += `</div>`;
        }
        contentContainer.innerHTML = html;
    }

    renderSubContent(subKeys[0]);

    // Tab click handlers
    tabsContainer.querySelectorAll('.side-tab').forEach(tab => {
        tab.onclick = () => {
            tabsContainer.querySelectorAll('.side-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderSubContent(tab.dataset.detailTab);
        };
    });
}

/* ================================================================
   11b. MANUAL OPS LOGS RENDER
================================================================ */
function renderManualLogs() {
    const ops = getManualOps();
    const fmt = n => (n||0).toLocaleString('ru-RU');
    const isAdmin = currentUser && currentUser.role === 'Администратор';
    const delBtn = (id) => isAdmin ? `<button class="deal-delete-btn" data-delete-op="${id}" title="Удалить">🗑</button>` : '';
    // Returns
    const returns = ops.filter(m => m.type === 'return').sort((a,b) => b.date > a.date ? 1 : -1);
    const retLog = document.getElementById('return-log');
    retLog.innerHTML = returns.length === 0 ? '' : returns.map(r =>
        `<div class="manual-op-entry"><span class="op-date">${r.date}</span><span class="op-sum">Возврат: ${fmt(r.totalSum)} ₽</span><span class="op-interest">Проценты: ${fmt(r.interestSum)} ₽</span><span style="color:var(--text-secondary);">${r.userLogin||''}</span>${delBtn(r.id)}</div>`
    ).join('');
    // Extensions
    const exts = ops.filter(m => m.type === 'extension').sort((a,b) => b.date > a.date ? 1 : -1);
    const extLog = document.getElementById('ext-log');
    extLog.innerHTML = exts.length === 0 ? '' : exts.map(e =>
        `<div class="manual-op-entry"><span class="op-date">${e.date}</span><span class="op-sum">Продление: ${fmt(e.totalSum)} ₽</span><span class="op-interest">Проценты: ${fmt(e.interestSum)} ₽</span><span style="color:var(--text-secondary);">${e.userLogin||''}</span>${delBtn(e.id)}</div>`
    ).join('');
    // Online
    const onlines = ops.filter(m => m.type === 'online').sort((a,b) => b.date > a.date ? 1 : -1);
    const onLog = document.getElementById('online-log');
    onLog.innerHTML = onlines.length === 0 ? '' : onlines.map(o =>
        `<div class="manual-op-entry"><span class="op-date">${o.date}</span><span class="op-fio">${o.fio||'-'}</span><span class="op-sum">Займ: ${fmt(o.loanSum)} ₽</span><span>Вес: ${(o.weight||0).toFixed(3)} г</span><span>Цена/г: ${fmt(o.pricePerGram)} ₽</span>${o.blocked ? '<span style="color:var(--danger);font-weight:800;">⛔ Блокировка</span>' : ''}${delBtn(o.id)}</div>`
    ).join('');
}

/* ================================================================
   11c. MANUAL OPS SAVE
================================================================ */
function saveLoanReturn() {
    const totalSum = parseVal(document.getElementById('return-total').value);
    const interestSum = parseVal(document.getElementById('return-interest').value);
    if (totalSum <= 0) return;
    const now = new Date();
    const ops = getManualOps();
    ops.push({
        id: Date.now().toString(36),
        type: 'return',
        date: `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
        timestamp: now.toISOString(),
        totalSum, interestSum,
        userId: currentUser ? currentUser.id : '',
        userLogin: currentUser ? currentUser.login : ''
    });
    saveManualOps(ops);
    document.getElementById('return-total').value = '';
    document.getElementById('return-interest').value = '';
    refreshStats();
    refreshPlan();
}

function saveLoanExtension() {
    const interestSum = parseVal(document.getElementById('ext-interest').value);
    if (interestSum <= 0) return;
    const now = new Date();
    const ops = getManualOps();
    ops.push({
        id: Date.now().toString(36),
        type: 'extension',
        date: `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
        timestamp: now.toISOString(),
        totalSum: interestSum, interestSum,
        userId: currentUser ? currentUser.id : '',
        userLogin: currentUser ? currentUser.login : ''
    });
    saveManualOps(ops);
    document.getElementById('ext-interest').value = '';
    refreshStats();
    refreshPlan();
}

function calcOnlineExtension() {
    const fio = document.getElementById('online-fio').value.trim();
    const loanSum = parseVal(document.getElementById('online-loan').value);
    const weight = parseVal(document.getElementById('online-weight').value);
    const resultEl = document.getElementById('online-result');
    const ppgEl = document.getElementById('online-ppg');
    const warnEl = document.getElementById('online-block-warn');
    if (loanSum <= 0 || weight <= 0) { resultEl.classList.add('hidden'); return; }
    const ppg = Math.round(loanSum / weight);
    resultEl.classList.remove('hidden');
    ppgEl.textContent = ppg.toLocaleString('ru-RU') + ' ₽';
    const blocked = ppg > 10000;
    warnEl.classList.toggle('hidden', !blocked);
    ppgEl.style.color = blocked ? 'var(--danger)' : 'var(--success)';
    // Save to log
    const now = new Date();
    const ops = getManualOps();
    ops.push({
        id: Date.now().toString(36),
        type: 'online',
        date: `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
        timestamp: now.toISOString(),
        fio, loanSum, weight, pricePerGram: ppg, blocked,
        userId: currentUser ? currentUser.id : '',
        userLogin: currentUser ? currentUser.login : ''
    });
    saveManualOps(ops);
    document.getElementById('online-fio').value = '';
    document.getElementById('online-loan').value = '';
    document.getElementById('online-weight').value = '';
    renderManualLogs();
}

/* ================================================================
   12. PLAN — PER SUBDIVISION
================================================================ */
function getSubdivisions() {
    const users = getUsers();
    const subs = new Set();
    users.forEach(u => { if (u.subdivision) subs.add(u.subdivision); });
    return [...subs].sort();
}

function refreshPlan() {
    const section = document.getElementById('plan-section');
    if (!currentUser || !canSetPlan(currentUser.role)) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    document.getElementById('plan-month').textContent = monthNames[now.getMonth()] + ' ' + now.getFullYear();
    const isAdmin = currentUser && currentUser.role === ROLES.ADMIN;
    const subWrap = document.getElementById('plan-sub-wrap');
    const subSelect = document.getElementById('plan-subdivision');

    // Subdivision dropdown — admin only
    if (isAdmin) {
        subWrap.style.display = '';
        const subs = getSubdivisions();
        const prevVal = subSelect.value;
        if (subs.length === 0) subs.push('Общее');
        subSelect.innerHTML = subs.map(s => `<option value="${s}"${s===prevVal?' selected':''}>${s}</option>`).join('');
        if (!prevVal && subs.length > 0) subSelect.value = subs[0];
    } else {
        subWrap.style.display = 'none';
    }

    const selectedSub = isAdmin ? subSelect.value : (currentUser.subdivision || 'Общее');
    const planKey = `${monthKey}:${selectedSub}`;
    const plans = getPlans();
    // backward compat: old plans stored as plans[monthKey]
    const existing = plans[planKey] || null;
    const dayOfMonth = now.getDate();
    const canEdit = isAdmin || (dayOfMonth >= 1 && dayOfMonth <= 5);
    const inp = document.getElementById('plan-value');
    const btn = document.getElementById('btn-save-plan');
    const status = document.getElementById('plan-status');
    if (existing && !isAdmin) {
        inp.value = existing.value;
        inp.disabled = true;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        status.innerHTML = `✅ План установлен: <b>${Number(existing.value).toLocaleString('ru-RU')} ₽</b> (${existing.setByLogin}, ${existing.setAt.split('T')[0]})`;
    } else if (existing && isAdmin) {
        inp.value = existing.value;
        inp.disabled = false;
        btn.disabled = false;
        btn.style.opacity = '1';
        status.innerHTML = `✅ План [${selectedSub}]: <b>${Number(existing.value).toLocaleString('ru-RU')} ₽</b>. Вы можете изменить.`;
    } else if (!canEdit) {
        inp.value = '';
        inp.disabled = true;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        status.textContent = '⚠ План можно установить только с 1 по 5 число месяца';
    } else {
        inp.value = '';
        inp.disabled = false;
        btn.disabled = false;
        btn.style.opacity = '1';
        status.textContent = `Введите сумму плана для "${selectedSub}"`;
    }

    // Plan progress
    const progressWrap = document.getElementById('plan-progress-wrap');
    if (existing) {
        // Get users in this subdivision
        const users = getUsers();
        const subLogins = users.filter(u => (u.subdivision || 'Общее') === selectedSub).map(u => u.login);
        const deals = getDeals().filter(d => d.date.startsWith(monthKey) && subLogins.includes(d.userLogin));
        let factSum = 0;
        deals.forEach(d => {
            factSum += (d.amountHand || 0) + (d.insuranceSum || 0) + (d.marginSum || 0);
        });
        const manualOps = getManualOps().filter(m => m.date.startsWith(monthKey) && subLogins.includes(m.userLogin));
        manualOps.forEach(m => {
            if (m.type === 'return' || m.type === 'extension') {
                factSum += m.totalSum || 0;
            }
        });
        const targetVal = Number(existing.value);
        const pct = targetVal > 0 ? Math.min(100, Math.round((factSum / targetVal) * 100)) : 0;
        progressWrap.classList.remove('hidden');
        document.getElementById('plan-progress-pct').textContent = pct + '%';
        document.getElementById('plan-progress-fill').style.width = pct + '%';
        document.getElementById('plan-fact-sum').textContent = factSum.toLocaleString('ru-RU') + ' ₽';
        document.getElementById('plan-target-sum').textContent = targetVal.toLocaleString('ru-RU') + ' ₽';
    } else {
        progressWrap.classList.add('hidden');
    }
}

function savePlan() {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
    const isAdmin = currentUser && currentUser.role === ROLES.ADMIN;
    const selectedSub = isAdmin ? document.getElementById('plan-subdivision').value : (currentUser.subdivision || 'Общее');
    const planKey = `${monthKey}:${selectedSub}`;
    const val = parseVal(document.getElementById('plan-value').value);
    if (val <= 0) return;
    const plans = getPlans();
    plans[planKey] = { value: val, subdivision: selectedSub, setByUserId: currentUser.id, setByLogin: currentUser.login, setAt: now.toISOString() };
    savePlans(plans);
    refreshPlan();
}

/* ================================================================
   13. USER MANAGEMENT
================================================================ */
function showUsersModal() {
    renderUsersList();
    document.getElementById('users-overlay').classList.add('active');
}

function renderUsersList() {
    const users = getUsers();
    const container = document.getElementById('users-list');
    const canCreate = creatableRoles(currentUser.role).length > 0;
    document.getElementById('btn-add-user').classList.toggle('hidden', !canCreate);
    const roleColors = {};
    roleColors[ROLES.ADMIN] = 'var(--danger)';
    roleColors[ROLES.SUBDIVISION] = 'var(--accent)';
    roleColors[ROLES.MANAGER] = 'var(--success)';
    roleColors[ROLES.EXPERT] = 'var(--premium-color)';
    container.innerHTML = users.map(u => {
        const color = roleColors[u.role] || 'var(--text-secondary)';
        const icon = ROLE_ICONS[u.role] || '';
        let actions = '';
        const myCreatable = creatableRoles(currentUser.role);
        if (currentUser.role === ROLES.ADMIN && u.id !== currentUser.id) {
            actions += `<button onclick="window._changeRole('${u.id}')">Роль</button>`;
            actions += `<button onclick="window._resetPw('${u.id}')">Сброс</button>`;
        } else if (myCreatable.includes(u.role) && u.id !== currentUser.id) {
            actions += `<button onclick="window._changeRole('${u.id}')">Роль</button>`;
        }
        return `<div class="user-row">
            <div class="user-icon" style="background:${color}22;color:${color};">${icon}</div>
            <div class="user-details">
                <div class="user-login">${u.login}</div>
                <div class="user-role">${u.role} · создан: ${u.createdAt ? u.createdAt.split('T')[0] : '—'} · кем: ${u.createdBy||'—'}</div>
            </div>
            <div class="user-actions">${actions}</div>
        </div>`;
    }).join('');
}

function openCreateUser() {
    document.getElementById('user-form-title').textContent = 'Создать пользователя';
    document.getElementById('uf-login').value = '';
    document.getElementById('uf-login').disabled = false;
    document.getElementById('uf-password').value = '';
    document.getElementById('uf-pw-group').classList.remove('hidden');
    document.getElementById('uf-error').textContent = '';
    const sel = document.getElementById('uf-role');
    sel.innerHTML = creatableRoles(currentUser.role).map(r => `<option value="${r}">${r}</option>`).join('');
    document.getElementById('user-form-overlay').classList.add('active');
    window._editingUserId = null;
}

async function saveUser() {
    const login = document.getElementById('uf-login').value.trim();
    const password = document.getElementById('uf-password').value;
    const role = document.getElementById('uf-role').value;
    const errEl = document.getElementById('uf-error');
    if (window._editingUserId) {
        const users = getUsers();
        const idx = users.findIndex(u => u.id === window._editingUserId);
        if (idx < 0) { errEl.textContent = 'Пользователь не найден'; return; }
        users[idx].role = role;
        saveUsers(users);
        document.getElementById('user-form-overlay').classList.remove('active');
        renderUsersList();
        return;
    }
    if (!login) { errEl.textContent = 'Введите логин'; return; }
    if (password.length < 6) { errEl.textContent = 'Пароль минимум 6 символов'; return; }
    const users = getUsers();
    if (users.find(u => u.login === login)) { errEl.textContent = 'Логин уже занят'; return; }
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    users.push({
        id: crypto.randomUUID ? crypto.randomUUID() : 'u-'+Date.now(),
        login, role, passwordHash: hash, salt,
        createdAt: new Date().toISOString(),
        mustChangePassword: true,
        createdBy: currentUser.login
    });
    saveUsers(users);
    document.getElementById('user-form-overlay').classList.remove('active');
    renderUsersList();
}

window._changeRole = function(userId) {
    const users = getUsers();
    const u = users.find(x => x.id === userId);
    if (!u) return;
    document.getElementById('user-form-title').textContent = 'Изменить роль: ' + u.login;
    document.getElementById('uf-login').value = u.login;
    document.getElementById('uf-login').disabled = true;
    document.getElementById('uf-pw-group').classList.add('hidden');
    document.getElementById('uf-error').textContent = '';
    const sel = document.getElementById('uf-role');
    const roles = currentUser.role === ROLES.ADMIN ? [ROLES.ADMIN,ROLES.SUBDIVISION,ROLES.MANAGER,ROLES.EXPERT] : creatableRoles(currentUser.role);
    sel.innerHTML = roles.map(r => `<option value="${r}" ${r===u.role?'selected':''}>${r}</option>`).join('');
    window._editingUserId = userId;
    document.getElementById('user-form-overlay').classList.add('active');
};

window._resetPw = async function(userId) {
    if (currentUser.role !== ROLES.ADMIN) return;
    const tempPw = 'Temp' + Math.random().toString(36).slice(2,8);
    const users = getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) return;
    const salt = generateSalt();
    const hash = await hashPassword(tempPw, salt);
    users[idx].salt = salt;
    users[idx].passwordHash = hash;
    users[idx].mustChangePassword = true;
    saveUsers(users);
    renderUsersList();
    alert('Пароль сброшен. Временный пароль: ' + tempPw);
};

/* ================================================================
   PASSWORD CHANGE
================================================================ */
let forcedPwChange = false;

function openChangePw(forced) {
    forcedPwChange = !!forced;
    document.getElementById('change-pw-forced-msg').classList.toggle('hidden', !forced);
    document.getElementById('btn-cancel-pw').classList.toggle('hidden', !!forced);
    document.getElementById('new-pw-1').value = '';
    document.getElementById('new-pw-2').value = '';
    document.getElementById('change-pw-error').textContent = '';
    document.getElementById('change-pw-overlay').classList.add('active');
}

async function doChangePw() {
    const pw1 = document.getElementById('new-pw-1').value;
    const pw2 = document.getElementById('new-pw-2').value;
    const errEl = document.getElementById('change-pw-error');
    if (pw1.length < 6) { errEl.textContent = 'Минимум 6 символов'; return; }
    if (pw1 !== pw2) { errEl.textContent = 'Пароли не совпадают'; return; }
    const users = getUsers();
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx < 0) return;
    const salt = generateSalt();
    const hash = await hashPassword(pw1, salt);
    users[idx].salt = salt;
    users[idx].passwordHash = hash;
    users[idx].mustChangePassword = false;
    saveUsers(users);
    currentUser = users[idx];
    document.getElementById('change-pw-overlay').classList.remove('active');
    forcedPwChange = false;
}

/* ================================================================
   STONE ADD — from original code
================================================================ */
function buildOptions(dataObj, sourceDict) {
    return Object.keys(dataObj).map(k => `<div class="select-option" data-val="${k}">${dataObj[k]} ${sourceDict[k]}</div>`).join('');
}

const btnAddStone = document.getElementById('btnAddStone');
if(btnAddStone) {
    btnAddStone.onclick = () => {
        document.querySelectorAll('.stone-row').forEach(r => r.classList.add('collapsed'));
        const div = document.createElement('div');
        div.className = 'stone-row';
        div.dataset.shape = 'krug';
        div.innerHTML = `
            <div class="stone-content">
                <div class="stone-inputs">
                    <div class="custom-select s-t-wrap">
                        <div class="select-trigger"><div class="trig-content">${SVGS.types.fianite} Фианит</div>${SVGS.arrow}</div>
                        <div class="select-options">${buildOptions(SVGS.types, SVGS.names)}</div>
                        <input type="hidden" class="val-t" value="fianite">
                    </div>
                    <div class="custom-select s-shape-wrap">
                        <div class="select-trigger"><div class="trig-content">${SVGS.shapes.krug} Круг</div>${SVGS.arrow}</div>
                        <div class="select-options">${buildOptions(SVGS.shapes, SVGS.names)}</div>
                        <input type="hidden" class="val-shape" value="krug">
                    </div>
                    <input type="text" inputmode="decimal" class="glass-input s-l" placeholder="Ø">
                    <input type="text" inputmode="decimal" class="glass-input s-w" placeholder="Д2">
                    <input type="text" inputmode="decimal" class="glass-input s-h" placeholder="Выс" data-auto="true">
                    <input type="text" inputmode="decimal" class="glass-input s-q" value="1" min="1">
                </div>
                <div class="stone-summary">
                    <div class="summary-text"><span class="summary-icon">${SVGS.types.fianite}</span><span style="margin-left:8px;color:var(--text-secondary);">Вставка (нажмите для ввода)</span></div>
                </div>
            </div>
            <button class="btn-remove" title="Удалить">×</button>
        `;
        const typeWrap = div.querySelector('.s-t-wrap');
        const shapeWrap = div.querySelector('.s-shape-wrap');
        const sType = div.querySelector('.val-t');
        const sShape = div.querySelector('.val-shape');
        const lInp = div.querySelector('.s-l');
        const wInp = div.querySelector('.s-w');
        const hInp = div.querySelector('.s-h');

        const updateUI = () => {
            const t = sType.value;
            if (t==='diamond') { sShape.value='krug'; shapeWrap.querySelector('.trig-content').innerHTML=`${SVGS.shapes.krug} Круг`; shapeWrap.querySelector('.select-options').innerHTML=buildOptions({'krug':SVGS.shapes.krug},SVGS.names); reattachSelectEvents(shapeWrap); }
            else if (t==='fianite'||t==='amber') { shapeWrap.querySelector('.select-options').innerHTML=buildOptions(SVGS.shapes,SVGS.names); reattachSelectEvents(shapeWrap); }
            const s = sShape.value; div.dataset.shape=s; div.dataset.type=t;
            shapeWrap.style.display=(t==='enamel'||t==='pearl'||t==='amber')?'none':'block';
            wInp.style.display=(s==='krug'||s==='shar'||s==='kvadrat'||t==='pearl')?'none':'block';
            hInp.style.display=(s==='krug'||s==='shar'||t==='pearl')?'none':'block';
            hInp.disabled=false;
            if(t==='enamel'){lInp.placeholder="Дл";wInp.placeholder="Шир";hInp.placeholder="см²";hInp.style.display="block";hInp.disabled=true;}
            else if(t==='pearl'){lInp.placeholder="Ø";}
            else{lInp.placeholder=(s==='krug'||s==='shar')?'Ø':'Д1';}
            autoCalc();
        };

        const autoCalc = () => {
            const t=sType.value;const l=parseVal(lInp.value);const w=parseVal(wInp.value)||l;
            if(t==='enamel') hInp.value=l>0?((l*w)/100).toFixed(2):"";
            else if(t!=='pearl'&&l>0&&hInp.dataset.auto==="true") hInp.value=(w*0.6).toFixed(2);
            else if(l===0&&w===0&&hInp.dataset.auto==="true") hInp.value="";
            calculate();
        };

        function reattachSelectEvents(sel) {
            sel.querySelectorAll('.select-option').forEach(opt => {
                opt.onclick = () => { sel.querySelector('.trig-content').innerHTML=opt.innerHTML; sel.querySelector('input').value=opt.dataset.val; sel.classList.remove('open'); updateUI(); };
            });
        }

        div.querySelectorAll('.custom-select').forEach(sel => {
            sel.querySelector('.select-trigger').onclick = () => { const state=sel.classList.contains('open'); document.querySelectorAll('.custom-select').forEach(s=>s.classList.remove('open')); if(!state)sel.classList.add('open'); };
            reattachSelectEvents(sel);
        });

        lInp.addEventListener('input',autoCalc);
        wInp.addEventListener('input',autoCalc);
        hInp.addEventListener('input',()=>{hInp.dataset.auto=hInp.value===''?"true":"false";autoCalc();});
        div.querySelector('.s-q').addEventListener('input',calculate);
        div.querySelector('.btn-remove').onclick=()=>{div.remove();calculate();};
        document.getElementById('stones-container').appendChild(div);
        updateUI();
    };
}

/* ================================================================
   EVENT LISTENERS
================================================================ */

// Global click delegation
document.addEventListener('click', e => {
    // Close dropdowns
    if(!e.target.closest('.custom-select')) document.querySelectorAll('.custom-select').forEach(s=>s.classList.remove('open'));
    // Interest toggle
    if(e.target.closest('#btn-interest-toggle')) document.getElementById('btn-interest-toggle').classList.toggle('open');
    // Stone accordion
    const summary = e.target.closest('.stone-summary');
    if(summary){const row=summary.closest('.stone-row');document.querySelectorAll('.stone-row').forEach(r=>r.classList.add('collapsed'));row.classList.remove('collapsed');}
    else if(!e.target.closest('.stone-row')&&!e.target.closest('#btnAddStone')&&!e.target.closest('.btn-remove')){document.querySelectorAll('.stone-row').forEach(r=>r.classList.add('collapsed'));}
    // Close profile dropdown when clicking outside
    if(!e.target.closest('#header-profile')) document.getElementById('profile-dropdown').classList.remove('open');
});

// Live recalc
document.addEventListener('input', e => { if(e.target.tagName==='INPUT'&&(e.target.type==='text'||e.target.type==='number')) calculate(); });
document.addEventListener('change', e => { if(e.target.tagName==='INPUT'&&(e.target.type==='radio'||e.target.type==='checkbox')) calculate(); });

// Login
document.getElementById('btn-login').onclick = doLogin;
document.getElementById('login-password').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('login-username').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-password').focus(); });

// Logout
document.getElementById('btn-logout').onclick = doLogout;

// Profile dropdown
document.getElementById('header-profile').addEventListener('click', e => {
    if(!e.target.closest('.profile-dropdown')) document.getElementById('profile-dropdown').classList.toggle('open');
});

// Change password
document.getElementById('btn-change-pw').onclick = () => openChangePw(false);
document.getElementById('btn-save-pw').onclick = doChangePw;
document.getElementById('btn-cancel-pw').onclick = () => { if(!forcedPwChange) document.getElementById('change-pw-overlay').classList.remove('active'); };

// Tabs
document.querySelectorAll('.header-tab').forEach(tab => { tab.onclick = () => switchTab(tab.dataset.tab); });

// Deal buttons
document.getElementById('btn-deal-yes').onclick = saveDeal;
document.getElementById('btn-deal-no').onclick = () => showDealFeedback(false);

// Stats
const nowDate = new Date();
const todayStr = `${nowDate.getFullYear()}-${pad(nowDate.getMonth()+1)}-${pad(nowDate.getDate())}`;
document.getElementById('stats-date-from').value = todayStr;
document.getElementById('stats-date-to').value = todayStr;
document.getElementById('btn-stats-apply').onclick = refreshStats;
initStatsPeriod();
document.getElementById('btn-stats-all').onclick = () => {
    document.getElementById('stats-date-from').value = '';
    document.getElementById('stats-date-to').value = '';
    document.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active-month'));
    refreshStats();
};
document.getElementById('plan-subdivision').onchange = () => refreshPlan();

// Premium
document.getElementById('premium-badge').onclick = showPremiumModal;
document.getElementById('btn-close-premium').onclick = () => document.getElementById('premium-overlay').classList.remove('active');

// Users
document.getElementById('btn-manage-users').onclick = showUsersModal;
document.getElementById('btn-close-users').onclick = () => document.getElementById('users-overlay').classList.remove('active');
document.getElementById('btn-add-user').onclick = openCreateUser;
document.getElementById('btn-uf-save').onclick = saveUser;
document.getElementById('btn-uf-cancel').onclick = () => document.getElementById('user-form-overlay').classList.remove('active');

// Plan
document.getElementById('btn-save-plan').onclick = savePlan;

// Manual ops
document.getElementById('btn-save-return').onclick = saveLoanReturn;
document.getElementById('btn-save-ext').onclick = saveLoanExtension;
document.getElementById('btn-calc-online').onclick = calcOnlineExtension;

// Manual ops tab switching
document.querySelectorAll('[data-mop-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('[data-mop-tab]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.mop-pane').forEach(p => p.classList.remove('active'));
        document.getElementById('mop-' + tab.dataset.mopTab).classList.add('active');
    });
});

// Pins toggle
const pinsToggle = document.getElementById('hasPins');
if (pinsToggle) {
    pinsToggle.addEventListener('change', () => {
        const wrap = document.getElementById('pins-qty-wrap');
        const statusEl = document.getElementById('pins-status');
        if (pinsToggle.checked) {
            wrap.classList.remove('hidden');
            statusEl.textContent = 'Активно';
        } else {
            wrap.classList.add('hidden');
            statusEl.textContent = 'Отключено';
        }
        calculate();
    });
}
const pinsQtyInput = document.getElementById('pinsQty');
if (pinsQtyInput) { pinsQtyInput.addEventListener('input', calculate); }

/* ================================================================
   INIT
================================================================ */
(async () => {
    await bootstrapAdmin();
    await tryAutoLogin();
    calculate();
})();

}); // end DOMContentLoaded
