const state = {
  projects: [],
  currentRabProjectId: null,
  rabItems: [],
  currentPetaProjectId: null,
  routePoints: [],
  map: null,
  polyline: null,
  markers: [],
};

function formatRupiah(n) {
  const v = Math.round(Number(n) || 0);
  return 'Rp ' + v.toLocaleString('id-ID');
}

// ---------- NAVIGATION ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  if (view === 'dashboard') loadDashboard();
  if (view === 'proyek') loadProjects();
  if (view === 'rab') loadRabProjectOptions();
  if (view === 'peta') loadPetaProjectOptions();
}

// ---------- DASHBOARD ----------
async function loadDashboard() {
  const stats = await window.api.getDashboardStats();
  document.getElementById('stat-total-proyek').textContent = stats.totalProyek;
  document.getElementById('stat-total-nilai').textContent = formatRupiah(stats.totalNilai);
  document.getElementById('stat-berjalan').textContent = stats.proyekBerjalan;
  document.getElementById('stat-selesai').textContent = stats.proyekSelesai;

  const donut = document.getElementById('avg-donut');
  donut.style.setProperty('--pct', stats.avgProgress + '%');
  document.getElementById('avg-progress-text').textContent = stats.avgProgress + '%';

  const recentWrap = document.getElementById('recent-projects');
  if (!stats.recent.length) {
    recentWrap.innerHTML = '<div class="empty">Belum ada proyek. Tambahkan proyek baru di menu Proyek.</div>';
  } else {
    recentWrap.innerHTML = stats.recent
      .map(
        (p) => `
      <div class="recent-item">
        <div>
          <div class="r-name">${escapeHtml(p.nama || '(Tanpa nama)')}</div>
          <div class="r-meta">Progress ${p.progress}%</div>
        </div>
        <div class="r-meta">${formatRupiah(p.nilai)}</div>
      </div>`
      )
      .join('');
  }
}

// ---------- PROYEK ----------
async function loadProjects() {
  state.projects = await window.api.getProjects();
  const tbody = document.getElementById('project-table-body');
  if (!state.projects.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Belum ada data proyek.</td></tr>';
    return;
  }
  tbody.innerHTML = state.projects
    .map(
      (p) => `
    <tr>
      <td>${escapeHtml(p.nama)}</td>
      <td>${escapeHtml(p.lokasi)}</td>
      <td>${p.panjang}</td>
      <td>${escapeHtml(p.jenisKonstruksi)}</td>
      <td>${p.progress || 0}%</td>
      <td>${formatRupiah(p.nilaiProyek)}</td>
      <td><button class="btn-danger-link" data-del="${p.id}">Hapus</button></td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (confirm('Hapus proyek ini?')) {
        await window.api.deleteProject(b.dataset.del);
        loadProjects();
      }
    });
  });
}

const modal = document.getElementById('project-form-modal');
document.getElementById('btn-new-project').addEventListener('click', () => modal.classList.remove('hidden'));
document.getElementById('btn-cancel-project').addEventListener('click', () => modal.classList.add('hidden'));

document.getElementById('btn-save-project').addEventListener('click', async () => {
  const nama = document.getElementById('f-nama').value.trim();
  if (!nama) {
    alert('Nama proyek wajib diisi');
    return;
  }
  const payload = {
    nama,
    lokasi: document.getElementById('f-lokasi').value.trim(),
    panjang: document.getElementById('f-panjang').value,
    lebar: document.getElementById('f-lebar').value,
    jenisKonstruksi: document.getElementById('f-jenisKonstruksi').value,
    tebalPerkerasan: document.getElementById('f-tebal').value,
    jenisPondasi: document.getElementById('f-jenisPondasi').value,
    kondisiTanah: document.getElementById('f-kondisiTanah').value,
    drainase: document.getElementById('f-drainase').value === 'true',
    bahuJalan: document.getElementById('f-bahuJalan').value === 'true',
    catatan: document.getElementById('f-catatan').value.trim(),
  };
  await window.api.addProject(payload);
  modal.classList.add('hidden');
  ['f-nama', 'f-lokasi', 'f-panjang', 'f-lebar', 'f-tebal', 'f-catatan'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  loadProjects();
});

// ---------- ESTIMASI RAB ----------
async function loadRabProjectOptions() {
  state.projects = await window.api.getProjects();
  const sel = document.getElementById('rab-project-select');
  sel.innerHTML =
    '<option value="">-- Pilih Proyek --</option>' +
    state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.nama)}</option>`).join('');
}

document.getElementById('rab-project-select').addEventListener('change', async (e) => {
  const id = e.target.value;
  const detail = document.getElementById('rab-detail');
  if (!id) {
    detail.classList.add('hidden');
    return;
  }
  const project = await window.api.getProject(id);
  state.currentRabProjectId = id;
  state.rabItems = project.rabItems && project.rabItems.length ? project.rabItems : [];

  if (!state.rabItems.length) {
    const defaults = await window.api.getDefaultPrices();
    state.rabItems = defaults.slice(0, 6).map((d) => ({
      kategori: d.kategori,
      uraian: d.uraian,
      volume: 0,
      satuan: d.satuan,
      harga: d.harga,
    }));
  }

  document.getElementById('rab-info-card').innerHTML = `
    <div><div class="label">Proyek</div><div class="value">${escapeHtml(project.nama)}</div></div>
    <div><div class="label">Lokasi</div><div class="value">${escapeHtml(project.lokasi || '-')}</div></div>
    <div><div class="label">Panjang x Lebar</div><div class="value">${project.panjang}m x ${project.lebar}m</div></div>
    <div><div class="label">Konstruksi / Tebal</div><div class="value">${escapeHtml(project.jenisKonstruksi)} / ${project.tebalPerkerasan}cm</div></div>
  `;

  detail.classList.remove('hidden');
  renderRabTable();
});

function renderRabTable() {
  const tbody = document.getElementById('rab-table-body');
  tbody.innerHTML = '';
  let lastKategori = null;

  state.rabItems.forEach((item, idx) => {
    if (item.kategori && item.kategori !== lastKategori) {
      lastKategori = item.kategori;
      const catRow = document.createElement('tr');
      catRow.className = 'rab-cat-row';
      catRow.innerHTML = `<td colspan="7">${escapeHtml(item.kategori)}</td>`;
      tbody.appendChild(catRow);
    }
    const jumlah = (Number(item.volume) || 0) * (Number(item.harga) || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><input type="text" data-field="uraian" value="${escapeAttr(item.uraian)}" /></td>
      <td><input type="number" data-field="volume" value="${item.volume}" style="width:80px" /></td>
      <td><input type="text" data-field="satuan" value="${escapeAttr(item.satuan)}" style="width:60px" /></td>
      <td><input type="number" data-field="harga" value="${item.harga}" style="width:110px" /></td>
      <td>${formatRupiah(jumlah)}</td>
      <td><button class="btn-danger-link" data-del-row="${idx}">Hapus</button></td>
    `;
    tr.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.rabItems[idx][inp.dataset.field] = inp.dataset.field === 'volume' || inp.dataset.field === 'harga'
          ? Number(inp.value)
          : inp.value;
        renderRabTable();
      });
    });
    tr.querySelector('[data-del-row]').addEventListener('click', () => {
      state.rabItems.splice(idx, 1);
      renderRabTable();
    });
    tbody.appendChild(tr);
  });

  const total = state.rabItems.reduce((s, it) => s + (Number(it.volume) || 0) * (Number(it.harga) || 0), 0);
  document.getElementById('rab-total').textContent = formatRupiah(total);
}

document.getElementById('btn-add-rab-row').addEventListener('click', () => {
  state.rabItems.push({ kategori: '', uraian: '', volume: 0, satuan: 'm2', harga: 0 });
  renderRabTable();
});

document.getElementById('btn-save-rab').addEventListener('click', async () => {
  if (!state.currentRabProjectId) return;
  await window.api.saveRab(state.currentRabProjectId, state.rabItems);
  alert('RAB berhasil disimpan.');
  loadDashboard();
});

// ---------- PETA (RUTE PROYEK) ----------
const DEFAULT_CENTER = [-6.1783, 106.6319]; // Tangerang, Banten sebagai default view

async function loadPetaProjectOptions() {
  state.projects = await window.api.getProjects();
  const sel = document.getElementById('peta-project-select');
  sel.innerHTML =
    '<option value="">-- Pilih Proyek --</option>' +
    state.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.nama)}</option>`).join('');
}

document.getElementById('peta-project-select').addEventListener('change', async (e) => {
  const id = e.target.value;
  const detail = document.getElementById('peta-detail');
  if (!id) {
    detail.classList.add('hidden');
    return;
  }
  const project = await window.api.getProject(id);
  state.currentPetaProjectId = id;
  state.routePoints = (project.routePoints || []).map((p) => ({ lat: p.lat, lng: p.lng }));

  detail.classList.remove('hidden');
  initMapIfNeeded();
  setTimeout(() => state.map.invalidateSize(), 50);
  renderRoute(true);
});

function initMapIfNeeded() {
  if (state.map) return;
  state.map = L.map('map').setView(DEFAULT_CENTER, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);

  state.polyline = L.polyline([], { color: '#1a56b0', weight: 5 }).addTo(state.map);

  state.map.on('click', (e) => {
    if (!state.currentPetaProjectId) return;
    state.routePoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    renderRoute(false);
  });
}

function renderRoute(fitBounds) {
  // Bersihkan marker lama
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers = [];

  const latlngs = state.routePoints.map((p) => [p.lat, p.lng]);
  state.polyline.setLatLngs(latlngs);

  state.routePoints.forEach((p, idx) => {
    let color = '#1a56b0';
    let label = String(idx + 1);
    if (idx === 0) { color = '#17a673'; label = 'A'; }
    if (idx === state.routePoints.length - 1 && state.routePoints.length > 1) { color = '#e05252'; label = 'B'; }

    const icon = L.divIcon({
      className: 'route-marker',
      html: `<div style="background:${color};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);">${label}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const marker = L.marker([p.lat, p.lng], { icon, draggable: true }).addTo(state.map);
    marker.on('drag', (ev) => {
      const ll = ev.target.getLatLng();
      state.routePoints[idx] = { lat: ll.lat, lng: ll.lng };
      state.polyline.setLatLngs(state.routePoints.map((pt) => [pt.lat, pt.lng]));
      updateJarak();
    });
    state.markers.push(marker);
  });

  if (fitBounds && latlngs.length > 1) {
    state.map.fitBounds(state.polyline.getBounds(), { padding: [30, 30] });
  } else if (fitBounds && latlngs.length === 1) {
    state.map.setView(latlngs[0], 15);
  }

  updateJarak();
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function updateJarak() {
  let totalMeter = 0;
  for (let i = 1; i < state.routePoints.length; i++) {
    totalMeter += haversineMeters(state.routePoints[i - 1], state.routePoints[i]);
  }
  const text =
    totalMeter >= 1000
      ? `Jarak rute: ${(totalMeter / 1000).toFixed(2)} km`
      : `Jarak rute: ${Math.round(totalMeter)} m`;
  document.getElementById('peta-jarak').textContent = text;
}

document.getElementById('btn-undo-point').addEventListener('click', () => {
  state.routePoints.pop();
  renderRoute(false);
});

document.getElementById('btn-clear-route').addEventListener('click', () => {
  if (state.routePoints.length && !confirm('Kosongkan semua titik rute pada proyek ini?')) return;
  state.routePoints = [];
  renderRoute(false);
});

document.getElementById('btn-save-route').addEventListener('click', async () => {
  if (!state.currentPetaProjectId) return;
  await window.api.saveRoute(state.currentPetaProjectId, state.routePoints);
  alert('Rute proyek berhasil disimpan.');
});

// ---------- UTIL ----------
function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------- INIT ----------
loadDashboard();
