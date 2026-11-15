import {
  generateRecoveryKey, createVaultKeys, encryptBackup, decryptBackup,
  unlockWithPassphrase, unlockWithRecoveryKey, rotatePassphrase, rotateRecoveryKey
} from "./crypto.js";

const STORE_KEY = "ahmet-private-v1";
const appRoot = document.querySelector("#app");
const messageRoot = document.querySelector("#message");
let dek = null;
let archive = null;
let lockTimer = null;

const emptyArchive = () => ({ schema: 1, notes: [], updatedAt: new Date().toISOString() });
const readStore = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
  catch { return null; }
};
const writeStore = (value) => localStorage.setItem(STORE_KEY, JSON.stringify(value));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
function say(text, error = false) {
  messageRoot.textContent = text || "";
  messageRoot.className = error ? "message error" : "message";
}
function lock(reason = "Kasa kilitlendi.") {
  dek = null;
  archive = null;
  clearTimeout(lockTimer);
  say(reason);
  renderLocked();
}
function scheduleLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lock("İşlem yapılmadığı için kasa kilitlendi."), 5 * 60 * 1000);
}
function touch() { if (dek) scheduleLock(); }

function renderSetup() {
  appRoot.innerHTML = `
    <div class="lock-icon">⌑</div><h2>Yeni kasa oluştur</h2>
    <p class="muted">En az 12 karakterli, başka yerde kullanmadığın güçlü bir parola belirle.</p>
    <form id="setup-form" class="form">
      <label>Yeni parola<input name="password" type="password" minlength="12" autocomplete="new-password" required></label>
      <label>Parolayı tekrar gir<input name="confirm" type="password" minlength="12" autocomplete="new-password" required></label>
      <button type="submit">Kasayı oluştur</button>
    </form>
    <p class="small">Parolan sunucuya gönderilmez. Unutursan kurtarma anahtarın gerekir.</p>`;
  document.querySelector("#setup-form").addEventListener("submit", setup);
}
async function setup(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const password = data.get("password");
  if (password !== data.get("confirm")) return say("Parolalar eşleşmiyor.", true);
  if (password.length < 12) return say("Parola en az 12 karakter olmalı.", true);
  try {
    say("Şifreleme anahtarları oluşturuluyor…");
    const recoveryKey = generateRecoveryKey();
    const keys = await createVaultKeys(password, recoveryKey);
    dek = keys.dek;
    archive = emptyArchive();
    const envelope = await encryptBackup(archive, dek);
    writeStore({ version: 1, keyRecord: {
      version: keys.version, keyAlgorithm: keys.keyAlgorithm,
      passphraseWrap: keys.passphraseWrap, recoveryWrap: keys.recoveryWrap
    }, envelope });
    renderRecoveryNotice(recoveryKey);
  } catch (error) { say("Kasa oluşturulamadı: " + error.message, true); }
}
function renderRecoveryNotice(key) {
  appRoot.innerHTML = `
    <div class="lock-icon">!</div><h2>Kurtarma anahtarını sakla</h2>
    <p class="muted">Bu anahtar kasanı başka bir cihazda veya parolanı unuttuğunda kurtarmak için gereklidir. Şimdi güvenli bir yere yaz. Bu ekrandan sonra tekrar gösterilmeyecek.</p>
    <div class="recovery-key" id="recovery-key"></div>
    <button id="copy-key" class="secondary" type="button">Anahtarı kopyala</button>
    <label class="check"><input id="saved-key" type="checkbox"> Anahtarı güvenli bir yere kaydettim.</label>
    <button id="continue" type="button" disabled>Kasaya devam et</button>`;
  document.querySelector("#recovery-key").textContent = key;
  document.querySelector("#copy-key").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(key); say("Kurtarma anahtarı kopyalandı."); }
    catch { say("Otomatik kopyalama desteklenmiyor; anahtarı elle kaydet.", true); }
  });
  const check = document.querySelector("#saved-key");
  const next = document.querySelector("#continue");
  check.addEventListener("change", () => next.disabled = !check.checked);
  next.addEventListener("click", () => renderVault());
}
function renderLocked() {
  const store = readStore();
  if (!store) return renderSetup();
  appRoot.innerHTML = `
    <div class="lock-icon">⌑</div><h2>Kasa kilitli</h2>
    <p class="muted">Devam etmek için kasanın parolasını gir.</p>
    <form id="unlock-form" class="form">
      <label>Parola<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Kilidi aç</button>
    </form>
    <button id="recovery-mode" class="text-button" type="button">Kurtarma anahtarıyla aç</button>
    <button id="import-backup" class="text-button" type="button">Şifreli yedeği içe aktar</button>
    <input id="backup-file" type="file" accept="application/json,.json" hidden>`;
  document.querySelector("#unlock-form").addEventListener("submit", unlock);
  document.querySelector("#recovery-mode").addEventListener("click", renderRecoveryUnlock);
  document.querySelector("#import-backup").addEventListener("click", () => document.querySelector("#backup-file").click());
  document.querySelector("#backup-file").addEventListener("change", importBackup);
}
async function unlock(event) {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get("password");
  const store = readStore();
  try {
    say("Parola doğrulanıyor…");
    dek = await unlockWithPassphrase(store.keyRecord, password);
    archive = await decryptBackup(store.envelope, dek);
    if (!archive || !Array.isArray(archive.notes)) throw new Error("Arşiv biçimi geçersiz.");
    renderVault();
    say("Kasa açıldı.");
  } catch {
    dek = null; archive = null;
    say("Parola yanlış veya şifreli veri bozulmuş.", true);
  }
}
function renderRecoveryUnlock() {
  appRoot.innerHTML = `
    <div class="lock-icon">⌑</div><h2>Kurtarma anahtarı</h2>
    <form id="recovery-form" class="form">
      <label>Kurtarma anahtarı<textarea name="key" rows="3" autocomplete="off" required></textarea></label>
      <button type="submit">Kurtarma anahtarıyla aç</button>
    </form>
    <button id="back" class="text-button" type="button">Girişe dön</button>`;
  document.querySelector("#back").addEventListener("click", renderLocked);
  document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = new FormData(event.currentTarget).get("key").trim();
    try {
      const store = readStore();
      dek = await unlockWithRecoveryKey(store.keyRecord, key);
      archive = await decryptBackup(store.envelope, dek);
      renderVault();
      say("Kasa kurtarma anahtarıyla açıldı.");
    } catch { dek = null; archive = null; say("Kurtarma anahtarı geçersiz veya yedek bozuk.", true); }
  });
}
async function persist() {
  if (!dek || !archive) throw new Error("Kasa kilitli.");
  archive.updatedAt = new Date().toISOString();
  const store = readStore();
  store.envelope = await encryptBackup(archive, dek);
  writeStore(store);
}
function renderVault() {
  if (!dek || !archive) return renderLocked();
  appRoot.innerHTML = `
    <div class="vault-head"><div><p class="eyebrow">KASA AÇIK</p><h2>Özel arşivin</h2></div><button id="lock-now" class="secondary compact" type="button">Kilitle</button></div>
    <form id="note-form" class="form">
      <label>Yeni not<textarea name="note" rows="4" maxlength="20000" placeholder="Notunu buraya yaz…" required></textarea></label>
      <button type="submit">Şifreli olarak kaydet</button>
    </form>
    <div class="note-list"><h3>Kayıtlı notlar</h3><div id="notes"></div></div>
    <div class="tools">
      <button id="share-vault" type="button">Şifreli kasanın dosyasını paylaş</button>
      <button id="export" class="secondary" type="button">Tüm kasanın şifreli yedeğini dışa aktar</button>
      <button id="change-password" class="secondary" type="button">Parolayı değiştir</button>
      <button id="show-recovery" class="secondary" type="button">Kurtarma anahtarını yenile</button>
    </div>
    <p class="small">Bu cihazdaki kayıtlar şifreli. Başka telefona taşımak için şifreli yedeği aktar ve kurtarma/parola bilgilerini güvenli biçimde kullan.</p>`;
  document.querySelector("#lock-now").addEventListener("click", () => lock());
  document.querySelector("#note-form").addEventListener("submit", addNote);
  document.querySelector("#share-vault").addEventListener("click", shareVaultFile);
  document.querySelector("#export").addEventListener("click", exportBackup);
  document.querySelector("#change-password").addEventListener("click", changePassword);
  document.querySelector("#show-recovery").addEventListener("click", renewRecovery);
  renderNotes();
  scheduleLock();
}
function renderNotes() {
  const root = document.querySelector("#notes");
  if (!root) return;
  if (!archive.notes.length) { root.innerHTML = '<p class="muted">Henüz not yok.</p>'; return; }
  root.innerHTML = archive.notes.map((note, index) => `
    <article class="note"><p>${escapeHtml(note.text)}</p><time>${escapeHtml(new Date(note.createdAt).toLocaleString("tr-TR"))}</time><button class="delete-note" data-index="${index}" type="button">Sil</button></article>`).join("");
  root.querySelectorAll(".delete-note").forEach((button) => button.addEventListener("click", async () => {
    archive.notes.splice(Number(button.dataset.index), 1);
    try { await persist(); renderNotes(); say("Not silindi."); }
    catch (error) { say(error.message, true); }
  }));
}
async function addNote(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const text = new FormData(form).get("note").trim();
  if (!text) return;
  archive.notes.unshift({ text, createdAt: new Date().toISOString() });
  try { await persist(); form.reset(); renderNotes(); say("Not şifrelenerek kaydedildi."); touch(); }
  catch (error) { say("Kaydedilemedi: " + error.message, true); }
}

async function shareVaultFile() {
  try {
    const store = readStore();
    const backup = {
      format: "AHMET-PRIVATE-BACKUP", version: 1,
      keyRecord: store.keyRecord, envelope: store.envelope
    };
    const file = new File([JSON.stringify(backup, null, 2)], "ahmet-private-encrypted-backup.json", {type:"application/json"});
    if (navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) {
      await navigator.share({
        title: "AHMET PRIVATE — şifreli kasa yedeği",
        text: "Bu dosya AHMET PRIVATE kasasının şifreli yedeğidir. Açmak için kasa parolası veya kurtarma anahtarı gerekir.",
        files: [file]
      });
      say("Şifreli kasa dosyası paylaşım menüsüne gönderildi.");
    } else {
      downloadJson("ahmet-private-encrypted-backup.json", backup);
      say("Şifreli kasa dosyası indirildi. Android paylaşım menüsünden gönderebilirsin.");
    }
    touch();
  } catch (error) {
    if (error.name !== "AbortError") say("Kasa dosyası paylaşılamadı: " + error.message, true);
  }
}
function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBackup() {
  const store = readStore();
  downloadJson("ahmet-private-encrypted-backup.json", {
    format: "AHMET-PRIVATE-BACKUP", version: 1,
    keyRecord: store.keyRecord, envelope: store.envelope
  });
  say("Şifreli yedek indirildi. Dosyayı güvenli yerde sakla.");
  touch();
}
async function changePassword() {
  if (!dek) return lock();
  const next = prompt("Yeni parolanı gir (en az 12 karakter):");
  if (!next) return;
  if (next.length < 12) return say("Yeni parola en az 12 karakter olmalı.", true);
  const confirmNext = prompt("Yeni parolanı tekrar gir:");
  if (next !== confirmNext) return say("Yeni parolalar eşleşmiyor; değiştirilmedi.", true);
  try {
    const store = readStore();
    store.keyRecord.passphraseWrap = await rotatePassphrase(dek, next);
    writeStore(store);
    say("Parola değiştirildi. Kurtarma anahtarın aynı kaldı.");
    touch();
  } catch (error) { say("Parola değiştirilemedi: " + error.message, true); }
}
async function renewRecovery() {
  if (!confirm("Eski kurtarma anahtarını geçersiz kılıp yenisini oluşturmak istiyor musun? Yeni anahtarı kaydetmeden devam etme.")) return;
  try {
    const key = generateRecoveryKey();
    const store = readStore();
    const recoveryWrap = await rotateRecoveryKey(dek, key);
    store.keyRecord.recoveryWrap = recoveryWrap;
    writeStore(store);
    renderRecoveryNotice(key);
    say("Yeni kurtarma anahtarı oluşturuldu.");
  } catch (error) { say("Anahtar yenilenemedi: " + error.message, true); }
}
async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== "AHMET-PRIVATE-BACKUP" || !data.keyRecord || !data.envelope) {
      throw new Error("Bu dosya AHMET PRIVATE yedeği değil.");
    }
    const current = readStore();
    if (current && !confirm("Bu cihazdaki mevcut kasa bilgileri içe aktarılan yedekle değiştirilecek. Devam edilsin mi?")) return;
    writeStore({ version: 1, keyRecord: data.keyRecord, envelope: data.envelope });
    say("Şifreli yedek içe aktarıldı. Parolanla açabilirsin.");
    renderLocked();
  } catch (error) { say("Yedek içe aktarılamadı: " + error.message, true); }
  finally { event.target.value = ""; }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && dek) lock("Uygulama arka plana geçti; kasa yeniden kilitlendi.");
});
window.addEventListener("pagehide", () => { if (dek) lock("Sayfa kapatıldı; kasa kilitlendi."); });
window.addEventListener("pageshow", () => { if (dek) lock("Uygulamaya geri dönüldü; kasa yeniden kilitlendi."); });
document.addEventListener("keydown", touch);
document.addEventListener("pointerdown", touch);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
renderLocked();
