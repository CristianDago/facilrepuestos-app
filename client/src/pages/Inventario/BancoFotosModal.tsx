import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../../services/api';
import type { ItemInventario } from '../../types';

export interface FotoBancoRepuesto {
  id: string;
  inventarioId: string | null;
  codigo: string;
  skuPublicoFrp?: string;
  nombreRepuesto: string;
  categoria: string;
  marcaVehiculo: string;
  fabricante?: string;
  proveedorId: string | null;
  proveedorNombre: string;
  angulo: 'FRONTAL' | 'ETIQUETA_OEM' | 'CONECTOR_DETALLE' | 'CAJA_EMPAQUE' | 'COMPARATIVA' | string;
  origenCaptura: string;
  esPrincipal: boolean;
  notas?: string;
  imagenDataUrl: string;
  createdAt: string;
}

interface Props {
  inventario: ItemInventario[];
  itemPreseleccionado?: ItemInventario | null;
  onClose: () => void;
  onFotoGuardada: () => void;
}

const ANGULOS_FOTO = [
  { value: 'FRONTAL', label: '📸 Vista Frontal (Principal)' },
  { value: 'ETIQUETA_OEM', label: '🏷️ Etiqueta Código OEM / SKU' },
  { value: 'CONECTOR_DETALLE', label: '🔩 Detalle Técnico / Conector / Medida' },
  { value: 'CAJA_EMPAQUE', label: '📦 Caja / Empaque Original' },
  { value: 'COMPARATIVA', label: '📐 Comparativa de Pieza' },
];

async function comprimirFotoProducto(fileOrDataUrl: File | string, maxWidth = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No se pudo inicializar canvas'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('No se pudo procesar la foto'));
    if (typeof fileOrDataUrl === 'string') {
      img.src = fileOrDataUrl;
    } else {
      const reader = new FileReader();
      reader.onload = e => { img.src = String(e.target?.result || ''); };
      reader.onerror = () => reject(new Error('Error leyendo archivo'));
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

export default function BancoFotosModal({
  inventario,
  itemPreseleccionado = null,
  onClose,
  onFotoGuardada,
}: Props) {
  const [fotos, setFotos] = useState<FotoBancoRepuesto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  // Formulario de nueva captura
  const [inventarioIdSel, setInventarioIdSel] = useState<string>(itemPreseleccionado?.id || '');
  const [anguloSel, setAnguloSel] = useState<string>('FRONTAL');
  const [esPrincipal, setEsPrincipal] = useState<boolean>(true);
  const [notas, setNotas] = useState<string>('');
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [origenCaptura, setOrigenCaptura] = useState<string>('camara_movil');

  // Filtros del banco de fotos
  const [busquedaBanco, setBusquedaBanco] = useState<string>(itemPreseleccionado?.codigo || '');
  const [filtroAngulo, setFiltroAngulo] = useState<string>('TODOS');
  const [fotoZoom, setFotoZoom] = useState<FotoBancoRepuesto | null>(null);

  // Cámara WebRTC en vivo (celular / notebook)
  const [camaraActiva, setCamaraActiva] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputMovilRef = useRef<HTMLInputElement | null>(null);
  const inputGaleriaRef = useRef<HTMLInputElement | null>(null);

  const cargarBancoFotos = async () => {
    setCargando(true);
    try {
      const res = await api.get<{ success: boolean; data: FotoBancoRepuesto[] }>('/inventario/banco-fotos');
      setFotos(res.data || []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar el banco de fotos');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarBancoFotos();
    return () => detenerCamara();
  }, []);

  const itemSeleccionadoObj = useMemo(
    () => inventario.find(i => i.id === inventarioIdSel) || null,
    [inventario, inventarioIdSel]
  );

  const iniciarCamaraEnVivo = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamaraActiva(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 80);
    } catch {
      // Fallback directo a cámara nativa del teléfono
      inputMovilRef.current?.click();
    }
  };

  const detenerCamara = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCamaraActiva(false);
  };

  const tomarFotoStream = async () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 1024;
    canvas.height = v.videoHeight || 768;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const comprimida = await comprimirFotoProducto(canvas.toDataURL('image/jpeg', 0.85), 1024, 0.8);
    detenerCamara();
    setPreviewDataUrl(comprimida);
    setOrigenCaptura('camara_vivo');
  };

  const handleArchivoImagen = async (e: React.ChangeEvent<HTMLInputElement>, origen: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const comprimida = await comprimirFotoProducto(file, 1024, 0.8);
      setPreviewDataUrl(comprimida);
      setOrigenCaptura(origen);
    } catch (err: any) {
      setError(err.message || 'No se pudo procesar la foto seleccionada');
    }
  };

  const handleGuardarEnBanco = async () => {
    if (!previewDataUrl) {
      setError('Primero saca una foto con tu teléfono o selecciona una imagen.');
      return;
    }
    setGuardando(true);
    setError('');
    setExito('');
    try {
      await api.post('/inventario/banco-fotos', {
        imagenDataUrl: previewDataUrl,
        inventarioId: inventarioIdSel || null,
        codigo: itemSeleccionadoObj?.codigo || '',
        nombreRepuesto: itemSeleccionadoObj?.nombre || 'FOTO BANCO PROVEEDOR',
        categoria: itemSeleccionadoObj?.categoria || 'OTROS',
        marcaVehiculo: itemSeleccionadoObj?.marcasCompatibles?.[0] || '',
        angulo: anguloSel,
        esPrincipal,
        notas,
        origenCaptura,
      });

      setPreviewDataUrl(null);
      setNotas('');
      setExito(
        itemSeleccionadoObj
          ? `✓ Foto guardada en el Banco de Fotos y asociada a "${itemSeleccionadoObj.nombre}" (${itemSeleccionadoObj.codigo}).`
          : '✓ Foto guardada en tu Banco de Fotos disponible para asociar a cualquier repuesto.'
      );
      await cargarBancoFotos();
      onFotoGuardada();
    } catch (e: any) {
      setError(e.message || 'Error al guardar la foto en el banco');
    } finally {
      setGuardando(false);
    }
  };

  const handleAsociarOCambiarPrincipal = async (foto: FotoBancoRepuesto, targetInventarioId: string) => {
    if (!targetInventarioId) return;
    try {
      await api.put(`/inventario/banco-fotos/${foto.id}/asociar`, {
        inventarioId: targetInventarioId,
        esPrincipal: true,
      });
      setExito('✓ Foto asignada como imagen principal del repuesto.');
      await cargarBancoFotos();
      onFotoGuardada();
    } catch (e: any) {
      setError(e.message || 'No se pudo asociar la foto');
    }
  };

  const handleEliminarFoto = async (fotoId: string) => {
    if (!window.confirm('¿Eliminar esta foto del Banco de Fotos?')) return;
    try {
      await api.delete(`/inventario/banco-fotos/${fotoId}`);
      setFotos(prev => prev.filter(f => f.id !== fotoId));
      onFotoGuardada();
    } catch (e: any) {
      setError(e.message || 'No se pudo eliminar la foto');
    }
  };

  const fotosFiltradas = useMemo(() => {
    return fotos.filter(f => {
      if (filtroAngulo !== 'TODOS' && f.angulo !== filtroAngulo) return false;
      if (busquedaBanco.trim()) {
        const q = busquedaBanco.toLowerCase();
        const match =
          (f.nombreRepuesto || '').toLowerCase().includes(q) ||
          (f.codigo || '').toLowerCase().includes(q) ||
          (f.skuPublicoFrp || '').toLowerCase().includes(q) ||
          (f.categoria || '').toLowerCase().includes(q) ||
          (f.notas || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [fotos, filtroAngulo, busquedaBanco]);

  return (
    <div className="overlay open" style={{ zIndex: 1100 }}>
      <div
        className="modal"
        style={{
          maxWidth: '1040px',
          width: '96vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '1.35rem 1.5rem',
        }}
      >
        {/* Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div className="modal-title" style={{ marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <span>📸 Banco de Fotos de Repuestos (Captura Móvil Proveedor)</span>
              <span
                style={{
                  background: '#e0f2fe',
                  color: '#0369a1',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '2px 9px',
                  borderRadius: 999,
                }}
              >
                {fotos.length} foto(s) registradas
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Saca fotos reales a tus repuestos con la cámara de tu teléfono y guárdalas asociadas al SKU en tu Banco de Fotos para el catálogo y cotizaciones IA.
            </div>
          </div>
          <button className="btn btn-dark btn-sm" onClick={onClose}>✕ Cerrar</button>
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.65rem 0.9rem', borderRadius: 8, marginBottom: '0.85rem', fontSize: '0.82rem', fontWeight: 600 }}>
            ⚠️ {error}
          </div>
        )}
        {exito && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '0.65rem 0.9rem', borderRadius: 8, marginBottom: '0.85rem', fontSize: '0.82rem', fontWeight: 700 }}>
            {exito}
          </div>
        )}

        {/* Panel Superior: Captura con Teléfono y Asociación a Repuesto */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 10,
            padding: '1rem',
            marginBottom: '1.2rem',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '0.7rem' }}>
            📱 1. Capturar Nueva Foto de Producto con tu Teléfono
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.85rem', alignItems: 'start' }}>
            {/* Columna A: Selección de repuesto y ángulo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div className="field">
                <label>Repuesto Asociado en tu Inventario</label>
                <select
                  value={inventarioIdSel}
                  onChange={e => setInventarioIdSel(e.target.value)}
                  style={{ fontWeight: 600 }}
                >
                  <option value="">— Guardar en Banco General (asociar después) —</option>
                  {inventario.map(it => (
                    <option key={it.id} value={it.id}>
                      {it.codigo ? `[${it.codigo}] ` : ''}{it.nombre} (Stock: {it.stock})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem' }}>
                <div className="field">
                  <label>Ángulo / Tipo de Toma</label>
                  <select value={anguloSel} onChange={e => setAnguloSel(e.target.value)}>
                    {ANGULOS_FOTO.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Nota / Detalle OEM (opcional)</label>
                  <input
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                    placeholder="Ej: Lado derecho 4 pines original"
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={esPrincipal}
                  onChange={e => setEsPrincipal(e.target.checked)}
                />
                Establecer como foto principal de portada del repuesto
              </label>
            </div>

            {/* Columna B: Botones de Cámara Móvil / Galería / Vista Previa */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {/* Inputs nativos ocultos */}
              <input
                ref={inputMovilRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={e => handleArchivoImagen(e, 'camara_movil')}
              />
              <input
                ref={inputGaleriaRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => handleArchivoImagen(e, 'galeria')}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => inputMovilRef.current?.click()}
                >
                  📱 Sacar Foto con Teléfono
                </button>
                <button
                  type="button"
                  className="btn btn-dark btn-sm"
                  onClick={camaraActiva ? detenerCamara : iniciarCamaraEnVivo}
                >
                  {camaraActiva ? '⏹ Cerrar Cámara' : '📷 Abrir Cámara en Vivo'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => inputGaleriaRef.current?.click()}
                >
                  🖼️ Subir de Galería
                </button>
              </div>

              {camaraActiva && (
                <div style={{ background: '#0f172a', padding: '0.65rem', borderRadius: 8, textAlign: 'center' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ maxWidth: '100%', maxHeight: '220px', borderRadius: 6 }}
                  />
                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={tomarFotoStream}>
                      📸 Capturar Foto
                    </button>
                    <button type="button" className="btn btn-dark btn-sm" onClick={detenerCamara}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {previewDataUrl && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.8rem',
                    background: '#fff',
                    padding: '0.6rem 0.8rem',
                    borderRadius: 8,
                    border: '2px solid #22c55e',
                  }}
                >
                  <img
                    src={previewDataUrl}
                    alt="Previsualización"
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#15803d' }}>
                      Foto lista para guardar
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                      {itemSeleccionadoObj
                        ? `Se asociará a: ${itemSeleccionadoObj.nombre}`
                        : 'Se guardará en el Banco General'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={guardando}
                    onClick={handleGuardarEnBanco}
                  >
                    {guardando ? 'Guardando...' : '💾 Guardar en Banco'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Panel Inferior: Galería del Banco de Fotos del Proveedor */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.85rem' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              🖼️ 2. Galería de tu Banco de Fotos ({fotosFiltradas.length})
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={busquedaBanco}
                onChange={e => setBusquedaBanco(e.target.value)}
                placeholder="Buscar por código SKU, nombre, categoría..."
                style={{ width: 240, fontSize: '0.78rem', padding: '5px 10px' }}
              />
              <select
                value={filtroAngulo}
                onChange={e => setFiltroAngulo(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '5px 10px' }}
              >
                <option value="TODOS">Todos los ángulos</option>
                {ANGULOS_FOTO.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              {busquedaBanco && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setBusquedaBanco('')}
                >
                  Ver todas
                </button>
              )}
            </div>
          </div>

          {cargando ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Cargando banco de fotos...</div>
          ) : fotosFiltradas.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 10, border: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.3rem' }}>📷</div>
              No hay fotos en el banco con este filtro. Usa el botón <strong>"📱 Sacar Foto con Teléfono"</strong> arriba para fotografiar tus repuestos.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))',
                gap: '0.85rem',
              }}
            >
              {fotosFiltradas.map(foto => (
                <div
                  key={foto.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    onClick={() => setFotoZoom(foto)}
                    style={{
                      position: 'relative',
                      height: 155,
                      background: '#f1f5f9',
                      cursor: 'zoom-in',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={foto.imagenDataUrl}
                      alt={foto.nombreRepuesto}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        background: 'rgba(15,23,42,0.78)',
                        color: '#fff',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 4,
                      }}
                    >
                      {foto.angulo}
                    </span>
                    {foto.esPrincipal && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          background: '#16a34a',
                          color: '#fff',
                          fontSize: '0.62rem',
                          fontWeight: 800,
                          padding: '2px 7px',
                          borderRadius: 4,
                        }}
                      >
                        ★ PRINCIPAL
                      </span>
                    )}
                  </div>

                  <div style={{ padding: '0.65rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.45rem' }}>
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                        {foto.nombreRepuesto}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#0369a1', fontFamily: 'monospace', fontWeight: 700, marginTop: 2 }}>
                        {foto.codigo ? `Cód: ${foto.codigo}` : 'Sin código'}
                        {foto.marcaVehiculo ? ` · ${foto.marcaVehiculo}` : ''}
                      </div>
                      {foto.notas && (
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 3 }}>
                          📝 {foto.notas}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.3rem' }}>
                      <select
                        value={foto.inventarioId || ''}
                        onChange={e => handleAsociarOCambiarPrincipal(foto, e.target.value)}
                        style={{ fontSize: '0.7rem', padding: '3px 6px', width: '100%' }}
                        title="Vincular esta foto del banco a un repuesto del inventario"
                      >
                        <option value="">🔗 Vincular a otro repuesto...</option>
                        {inventario.map(it => (
                          <option key={it.id} value={it.id}>
                            {it.codigo ? `[${it.codigo}] ` : ''}{it.nombre}
                          </option>
                        ))}
                      </select>

                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.35rem' }}>
                        {foto.inventarioId && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ flex: 1, fontSize: '0.66rem', padding: '3px 6px' }}
                            onClick={() => handleAsociarOCambiarPrincipal(foto, foto.inventarioId!)}
                          >
                            ⭐ Usar de Portada
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', fontSize: '0.66rem', padding: '3px 8px' }}
                          onClick={() => handleEliminarFoto(foto.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lightbox para ver foto en grande */}
        {fotoZoom && (
          <div
            onClick={() => setFotoZoom(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15,23,42,0.86)',
              zIndex: 1300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1.5rem',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#fff',
                borderRadius: 12,
                maxWidth: 720,
                width: '100%',
                overflow: 'hidden',
                padding: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{fotoZoom.nombreRepuesto}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Código: {fotoZoom.codigo || '—'} · Ángulo: {fotoZoom.angulo} · Proveedor: {fotoZoom.proveedorNombre}
                  </div>
                </div>
                <button className="btn btn-dark btn-sm" onClick={() => setFotoZoom(null)}>✕ Cerrar</button>
              </div>
              <img
                src={fotoZoom.imagenDataUrl}
                alt={fotoZoom.nombreRepuesto}
                style={{ width: '100%', maxHeight: '68vh', objectFit: 'contain', background: '#0f172a', borderRadius: 8 }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
