import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';

interface ItemFacturaAnalizado {
  idFila: string;
  seleccionado: boolean;
  codigo: string;
  nombre: string;
  fabricante: string;
  categoria: string;
  tipoPieza: string;
  marcaVehiculo: string;
  modelosSugeridos: string[];
  cantidad: number;
  costoUnitarioNeto: number;
  precioListaSugerido: number;
  descuentoTallerSugerido: number;
  subtotalNeto: number;
  yaExisteEnInventario: boolean;
  inventarioIdExistente: string | null;
  stockActual: number;
  costoAnterior: number | null;
}

interface FacturaHistorica {
  id: string;
  folio: string;
  rutEmisor: string;
  razonSocialEmisor: string;
  fechaEmision: string;
  condicionPago: string;
  proveedorNombre: string;
  creados: number;
  actualizados: number;
  totalUnidades: number;
  totalNeto: number;
  iva: number;
  totalBruto: number;
  tieneFotoFactura: boolean;
  imagenFacturaUrl?: string | null;
  createdAt: string;
  items: Array<{
    inventarioId: string;
    accion: 'CREADO' | 'ACTUALIZADO';
    codigo: string;
    skuPublicoFrp?: string;
    nombre: string;
    stockAnterior: number;
    cantidadSumada: number;
    stockFinal: number;
    costoUnitarioNeto: number;
  }>;
}

interface Props {
  categoriasDisponibles: string[];
  marcasDisponibles: string[];
  onClose: () => void;
  onSuccess: () => void;
}

const fmtCLP = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CL');

async function comprimirImagenCanvas(fileOrDataUrl: File | string, maxWidth = 1280, quality = 0.78): Promise<string> {
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
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
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

export default function FacturaCompraModal({
  categoriasDisponibles,
  marcasDisponibles,
  onClose,
  onSuccess,
}: Props) {
  const [tab, setTab] = useState<'cargar' | 'historial'>('cargar');
  const [analizando, setAnalizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [mensajeExito, setMensajeExito] = useState('');

  // Imagen o texto de factura
  const [imagenFactura, setImagenFactura] = useState<string | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState<string>('');
  const [mostrarTextoRaw, setMostrarTextoRaw] = useState(false);
  const [textoRaw, setTextoRaw] = useState('');

  // Cámara WebRTC en vivo
  const [camaraActiva, setCamaraActiva] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputCamaraMovilRef = useRef<HTMLInputElement | null>(null);
  const inputArchivoRef = useRef<HTMLInputElement | null>(null);

  // Datos extraídos de la factura
  const [metodoExtraccion, setMetodoExtraccion] = useState('');
  const [folio, setFolio] = useState('');
  const [rutEmisor, setRutEmisor] = useState('');
  const [razonSocialEmisor, setRazonSocialEmisor] = useState('');
  const [fechaEmision, setFechaEmision] = useState(() => new Date().toISOString().slice(0, 10));
  const [condicionPago, setCondicionPago] = useState('CONTADO / FACTURA');
  const [items, setItems] = useState<ItemFacturaAnalizado[]>([]);

  // Historial de facturas
  const [historial, setHistorial] = useState<FacturaHistorica[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [facturaExpandidaId, setFacturaExpandidaId] = useState<string | null>(null);

  useEffect(() => {
    return () => detenerCamara();
  }, []);

  useEffect(() => {
    if (tab === 'historial') {
      cargarHistorial();
    }
  }, [tab]);

  const cargarHistorial = async () => {
    setCargandoHistorial(true);
    try {
      const res = await api.get<{ success: boolean; data: FacturaHistorica[] }>('/inventario/facturas');
      setHistorial(res.data || []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar historial de facturas');
    } finally {
      setCargandoHistorial(false);
    }
  };

  const iniciarCamara = async () => {
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
      // Si el navegador bloquea WebRTC o no tiene cámara en desktop, abrir el selector con capture="environment"
      inputCamaraMovilRef.current?.click();
    }
  };

  const detenerCamara = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCamaraActiva(false);
  };

  const capturarFotoDeVideo = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = await comprimirImagenCanvas(canvas.toDataURL('image/jpeg', 0.85), 1280, 0.8);
    detenerCamara();
    setImagenFactura(dataUrl);
    setNombreArchivo(`foto_factura_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`);
    await analizarFactura({ imagenDataUrl: dataUrl, nombreArchivo: 'foto_camara_factura.jpg' });
  };

  const handleArchivoSeleccionado = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setNombreArchivo(file.name);

    if (file.name.toLowerCase().endsWith('.xml') || file.type.includes('xml') || file.type === 'text/plain') {
      const txt = await file.text();
      setTextoRaw(txt);
      await analizarFactura({ textoRaw: txt, nombreArchivo: file.name });
      return;
    }

    if (file.type.startsWith('image/')) {
      try {
        const comprimida = await comprimirImagenCanvas(file, 1280, 0.8);
        setImagenFactura(comprimida);
        await analizarFactura({ imagenDataUrl: comprimida, nombreArchivo: file.name });
      } catch (err: any) {
        setError(err.message || 'Error al procesar imagen de la factura');
      }
    } else {
      // PDF u otro formato: analizar con nombre de archivo / OCR inteligente
      await analizarFactura({ nombreArchivo: file.name });
    }
  };

  const analizarFactura = async (payload: {
    imagenDataUrl?: string | null;
    textoRaw?: string;
    nombreArchivo?: string;
    plantillaId?: string;
  }) => {
    setAnalizando(true);
    setError('');
    setMensajeExito('');
    try {
      const res = await api.post<{
        success: boolean;
        data: {
          metodoExtraccion: string;
          folio: string;
          rutEmisor: string;
          razonSocialEmisor: string;
          fechaEmision: string;
          condicionPago: string;
          items: ItemFacturaAnalizado[];
        };
      }>('/inventario/facturas/analizar', payload);

      const d = res.data;
      setMetodoExtraccion(d.metodoExtraccion);
      setFolio(d.folio);
      setRutEmisor(d.rutEmisor);
      setRazonSocialEmisor(d.razonSocialEmisor);
      setFechaEmision(d.fechaEmision);
      setCondicionPago(d.condicionPago);
      setItems(d.items || []);
    } catch (e: any) {
      setError(e.message || 'No se pudo analizar la factura');
    } finally {
      setAnalizando(false);
    }
  };

  const actualizarItem = (idFila: string, campo: keyof ItemFacturaAnalizado, valor: any) => {
    setItems(prev =>
      prev.map(it => {
        if (it.idFila !== idFila) return it;
        const actualizado = { ...it, [campo]: valor };
        actualizado.subtotalNeto = (Number(actualizado.cantidad) || 0) * (Number(actualizado.costoUnitarioNeto) || 0);
        return actualizado;
      })
    );
  };

  const agregarFilaManual = () => {
    setItems(prev => [
      ...prev,
      {
        idFila: `manual-${Date.now()}`,
        seleccionado: true,
        codigo: '',
        nombre: '',
        fabricante: 'BOSCH',
        categoria: categoriasDisponibles[0] || 'MOTOR',
        tipoPieza: 'REPUESTO GENERAL',
        marcaVehiculo: marcasDisponibles[0] || 'TOYOTA',
        modelosSugeridos: [],
        cantidad: 1,
        costoUnitarioNeto: 10000,
        precioListaSugerido: 12500,
        descuentoTallerSugerido: 10,
        subtotalNeto: 10000,
        yaExisteEnInventario: false,
        inventarioIdExistente: null,
        stockActual: 0,
        costoAnterior: null,
      },
    ]);
  };

  const handleConfirmarIngreso = async () => {
    const seleccionados = items.filter(i => i.seleccionado && i.nombre.trim());
    if (seleccionados.length === 0) {
      setError('Selecciona al menos un repuesto válido de la factura para ingresar.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const res = await api.post<{
        success: boolean;
        data: { creados: number; actualizados: number; totalUnidades: number; folio: string };
      }>('/inventario/facturas/ingresar', {
        folio: folio || 'S/F',
        rutEmisor,
        razonSocialEmisor,
        fechaEmision,
        condicionPago,
        items: seleccionados,
        imagenDataUrl: imagenFactura,
      });

      setMensajeExito(
        `✓ Factura Folio #${res.data.folio} ingresada con éxito: ${res.data.actualizados} repuesto(s) actualizaron su stock/costo y ${res.data.creados} nuevo(s) se crearon en tu catálogo (${res.data.totalUnidades} unidades sumadas).`
      );
      setTimeout(() => {
        onSuccess();
      }, 1200);
    } catch (e: any) {
      setError(e.message || 'Error al ingresar los ítems de la factura al inventario');
    } finally {
      setGuardando(false);
    }
  };

  const itemsSeleccionados = items.filter(i => i.seleccionado);
  const totalNetoSeleccionado = itemsSeleccionados.reduce((acc, i) => acc + i.subtotalNeto, 0);
  const ivaSeleccionado = Math.round(totalNetoSeleccionado * 0.19);
  const totalBrutoSeleccionado = totalNetoSeleccionado + ivaSeleccionado;

  return (
    <div className="overlay open" style={{ zIndex: 1100 }}>
      <div
        className="modal"
        style={{
          maxWidth: '1060px',
          width: '96vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '1.35rem 1.5rem',
        }}
      >
        {/* Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div className="modal-title" style={{ marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🧾 Inteligencia de Abastecimiento: Cargar / Fotografiar Factura de Compra</span>
              <span
                style={{
                  background: '#dcfce7',
                  color: '#166534',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  letterSpacing: '0.5px',
                }}
              >
                IA + OCR DTE SII
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Saca una foto a la factura de tu distribuidor mayorista con tu celular, sube el XML/PDF del SII o simula una compra mayorista para actualizar stock y costos en 1 clic.
            </div>
          </div>
          <button className="btn btn-dark btn-sm" onClick={onClose}>✕ Cerrar</button>
        </div>

        {/* Pestañas */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'cargar' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab('cargar')}
          >
            📸 Capturar / Analizar Factura
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'historial' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab('historial')}
          >
            🗂️ Historial de Facturas Ingresadas
          </button>
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.7rem 1rem', borderRadius: 8, marginBottom: '0.9rem', fontSize: '0.82rem', fontWeight: 600 }}>
            ⚠️ {error}
          </div>
        )}

        {mensajeExito && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '0.85rem 1rem', borderRadius: 8, marginBottom: '0.9rem', fontSize: '0.86rem', fontWeight: 700 }}>
            {mensajeExito}
          </div>
        )}

        {tab === 'cargar' && (
          <>
            {/* Zona de captura con teléfono / subida de archivo / plantillas mayoristas */}
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px dashed #94a3b8',
                borderRadius: 10,
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', alignItems: 'center' }}>
                  {/* Input oculto para cámara trasera del teléfono */}
                  <input
                    ref={inputCamaraMovilRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={handleArchivoSeleccionado}
                  />
                  {/* Input oculto para subir archivo imagen / XML / PDF */}
                  <input
                    ref={inputArchivoRef}
                    type="file"
                    accept="image/*,.xml,.pdf,.txt"
                    style={{ display: 'none' }}
                    onChange={handleArchivoSeleccionado}
                  />

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => inputCamaraMovilRef.current?.click()}
                    disabled={analizando}
                  >
                    📱 Sacar Foto Factura (Teléfono)
                  </button>

                  <button
                    type="button"
                    className="btn btn-dark btn-sm"
                    onClick={camaraActiva ? detenerCamara : iniciarCamara}
                    disabled={analizando}
                  >
                    {camaraActiva ? '⏹ Cerrar Cámara' : '📷 Cámara en Vivo'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => inputArchivoRef.current?.click()}
                    disabled={analizando}
                  >
                    📂 Subir Foto / XML SII / PDF
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setMostrarTextoRaw(v => !v)}
                  >
                    📋 Pegar XML SII / Texto
                  </button>
                </div>

                {/* Simulador rápido de cómo compran hoy los proveedores a mayoristas en Chile */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#475569' }}>
                    ⚡ Probar Factura Mayorista Real:
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                    onClick={() => analizarFactura({ plantillaId: 'emasa_bosch' })}
                    disabled={analizando}
                  >
                    🏢 EMASA (Bosch / Mann / NGK)
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                    onClick={() => analizarFactura({ plantillaId: 'mannheim_suspension' })}
                    disabled={analizando}
                  >
                    🏢 Mannheim (KYB / Sangsin / GMB)
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                    onClick={() => analizarFactura({ plantillaId: 'derco_mantencion' })}
                    disabled={analizando}
                  >
                    🏢 Derco Mayorista (Valeo / Gates)
                  </button>
                </div>
              </div>

              {/* Visor de cámara WebRTC si está activa */}
              {camaraActiva && (
                <div style={{ marginTop: '0.9rem', textAlign: 'center', background: '#0f172a', padding: '0.8rem', borderRadius: 8 }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ maxWidth: '100%', maxHeight: '320px', borderRadius: 6, border: '2px solid #38bdf8' }}
                  />
                  <div style={{ marginTop: '0.6rem', display: 'flex', justifyContent: 'center', gap: '0.6rem' }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={capturarFotoDeVideo}>
                      📸 Capturar y Analizar Factura
                    </button>
                    <button type="button" className="btn btn-dark btn-sm" onClick={detenerCamara}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Área para pegar XML DTE SII o líneas de factura */}
              {mostrarTextoRaw && (
                <div style={{ marginTop: '0.8rem' }}>
                  <textarea
                    rows={4}
                    value={textoRaw}
                    onChange={e => setTextoRaw(e.target.value)}
                    placeholder={`Pega aquí el XML DTE del SII (<Detalle><VlrCodigo>...</VlrCodigo>...) o líneas separadas por | :\n0986AF2950 | PASTILLAS DE FRENO DELANTERAS BOSCH HILUX | 6 | 24500\nW610/82 | FILTRO DE ACEITE MANN MAZDA 3 | 12 | 5800`}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.76rem', padding: '0.55rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                  <div style={{ marginTop: '0.4rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!textoRaw.trim() || analizando}
                      onClick={() => analizarFactura({ textoRaw })}
                    >
                      🧠 Extraer Ítems del Texto / XML
                    </button>
                  </div>
                </div>
              )}

              {/* Miniatura de la foto de la factura capturada */}
              {imagenFactura && (
                <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.85rem', background: '#fff', padding: '0.55rem 0.8rem', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <img
                    src={imagenFactura}
                    alt="Factura capturada"
                    style={{ width: 68, height: 68, objectFit: 'cover', borderRadius: 6, border: '1px solid #cbd5e1' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>
                      📷 Foto de Factura adjunta {nombreArchivo ? `(${nombreArchivo})` : ''}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                      Quedará guardada como respaldo digital en el historial de compras de tu portal.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => { setImagenFactura(null); setNombreArchivo(''); }}
                  >
                    Quitar foto
                  </button>
                </div>
              )}

              {analizando && (
                <div style={{ marginTop: '0.8rem', textAlign: 'center', padding: '0.9rem', color: '#0369a1', fontWeight: 700, fontSize: '0.86rem' }}>
                  ⏳ Analizando documento, detectando códigos OEM/SKU y cruzando con tu inventario actual...
                </div>
              )}
            </div>

            {/* Formulario de Cabecera de Factura + Tabla de Ítems detectados */}
            {items.length > 0 && (
              <>
                <div
                  style={{
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    padding: '0.9rem 1rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                      📑 Datos del Documento Mayorista ({metodoExtraccion || 'IA'})
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: '0.72rem', fontWeight: 700, padding: '3px 9px', borderRadius: 6 }}>
                        🔄 {items.filter(i => i.yaExisteEnInventario).length} ya existen (suman stock)
                      </span>
                      <span style={{ background: '#f0fdf4', color: '#15803d', fontSize: '0.72rem', fontWeight: 700, padding: '3px 9px', borderRadius: 6 }}>
                        ✨ {items.filter(i => !i.yaExisteEnInventario).length} repuestos nuevos
                      </span>
                    </div>
                  </div>

                  <div className="form-grid fg-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.65rem' }}>
                    <div className="field">
                      <label>N° Folio Factura</label>
                      <input value={folio} onChange={e => setFolio(e.target.value.toUpperCase())} placeholder="Ej: 3849201" />
                    </div>
                    <div className="field">
                      <label>RUT Distribuidor</label>
                      <input value={rutEmisor} onChange={e => setRutEmisor(e.target.value.toUpperCase())} placeholder="Ej: 91.504.000-7" />
                    </div>
                    <div className="field">
                      <label>Mayorista / Emisor</label>
                      <input value={razonSocialEmisor} onChange={e => setRazonSocialEmisor(e.target.value.toUpperCase())} placeholder="EMASA COMERCIAL S.A." />
                    </div>
                    <div className="field">
                      <label>Fecha Emisión</label>
                      <input type="date" value={fechaEmision} onChange={e => setFechaEmision(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Tabla editable de líneas de la factura */}
                <div className="tbl-wrap" style={{ marginBottom: '1rem', maxHeight: '340px', overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>✓</th>
                        <th>Estado Catálogo</th>
                        <th>Código / SKU</th>
                        <th>Descripción del Repuesto</th>
                        <th>Marca Rep.</th>
                        <th>Categoría</th>
                        <th>Marca Auto</th>
                        <th className="r">Cant. (+Stock)</th>
                        <th className="r">Costo Neto Unit.</th>
                        <th className="r">Subtotal Neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => (
                        <tr key={it.idFila} style={{ opacity: it.seleccionado ? 1 : 0.45 }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={it.seleccionado}
                              onChange={e => actualizarItem(it.idFila, 'seleccionado', e.target.checked)}
                            />
                          </td>
                          <td>
                            {it.yaExisteEnInventario ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  background: '#dbeafe',
                                  color: '#1e40af',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  padding: '2px 7px',
                                  borderRadius: 5,
                                }}
                                title={`Stock actual: ${it.stockActual} → Quedará en: ${it.stockActual + it.cantidad}`}
                              >
                                🔄 Stock {it.stockActual} → {it.stockActual + it.cantidad}
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-block',
                                  background: '#dcfce7',
                                  color: '#166534',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  padding: '2px 7px',
                                  borderRadius: 5,
                                }}
                              >
                                ✨ Nuevo SKU
                              </span>
                            )}
                          </td>
                          <td>
                            <input
                              value={it.codigo}
                              onChange={e => actualizarItem(it.idFila, 'codigo', e.target.value.toUpperCase())}
                              style={{ width: '105px', fontSize: '0.76rem', fontFamily: 'monospace', fontWeight: 700, padding: '4px 6px' }}
                            />
                          </td>
                          <td>
                            <input
                              value={it.nombre}
                              onChange={e => actualizarItem(it.idFila, 'nombre', e.target.value.toUpperCase())}
                              style={{ width: '100%', minWidth: '190px', fontSize: '0.76rem', padding: '4px 6px' }}
                            />
                          </td>
                          <td>
                            <input
                              value={it.fabricante}
                              onChange={e => actualizarItem(it.idFila, 'fabricante', e.target.value.toUpperCase())}
                              style={{ width: '92px', fontSize: '0.74rem', padding: '4px 6px' }}
                            />
                          </td>
                          <td>
                            <select
                              value={it.categoria}
                              onChange={e => actualizarItem(it.idFila, 'categoria', e.target.value)}
                              style={{ fontSize: '0.74rem', padding: '4px 6px' }}
                            >
                              {[...new Set([...categoriasDisponibles, it.categoria])].map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={it.marcaVehiculo}
                              onChange={e => actualizarItem(it.idFila, 'marcaVehiculo', e.target.value)}
                              style={{ fontSize: '0.74rem', padding: '4px 6px' }}
                            >
                              {[...new Set([...marcasDisponibles, it.marcaVehiculo])].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </td>
                          <td className="r">
                            <input
                              type="number"
                              min={1}
                              value={it.cantidad}
                              onChange={e => actualizarItem(it.idFila, 'cantidad', Math.max(1, parseInt(e.target.value, 10) || 1))}
                              style={{ width: '64px', textAlign: 'right', fontWeight: 800, fontSize: '0.8rem', padding: '4px 6px' }}
                            />
                          </td>
                          <td className="r">
                            <input
                              type="number"
                              min={0}
                              value={it.costoUnitarioNeto}
                              onChange={e => actualizarItem(it.idFila, 'costoUnitarioNeto', Math.max(0, parseInt(e.target.value, 10) || 0))}
                              style={{ width: '92px', textAlign: 'right', fontSize: '0.78rem', padding: '4px 6px' }}
                            />
                            {it.costoAnterior !== null && it.costoAnterior !== it.costoUnitarioNeto && (
                              <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                                Ant: {fmtCLP(it.costoAnterior)}
                              </div>
                            )}
                          </td>
                          <td className="r" style={{ fontWeight: 800, fontSize: '0.82rem' }}>
                            {fmtCLP(it.subtotalNeto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Resumen financiero e ingreso */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    background: '#0f172a',
                    color: '#fff',
                    padding: '0.9rem 1.2rem',
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="btn btn-outline btn-sm" style={{ color: '#fff', borderColor: '#475569' }} onClick={agregarFilaManual}>
                      + Agregar línea manual
                    </button>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>Ítems a ingresar</div>
                      <div style={{ fontSize: '1rem', fontWeight: 800 }}>
                        {itemsSeleccionados.length} SKU ({itemsSeleccionados.reduce((s, i) => s + i.cantidad, 0)} unid.)
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>Total Neto Factura</div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#38bdf8' }}>{fmtCLP(totalNetoSeleccionado)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>Total c/IVA (19%)</div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#4ade80' }}>{fmtCLP(totalBrutoSeleccionado)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <button type="button" className="btn btn-dark" onClick={onClose}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={guardando || itemsSeleccionados.length === 0}
                      onClick={handleConfirmarIngreso}
                    >
                      {guardando ? 'Ingresando Stock...' : '✅ Confirmar e Ingresar al Inventario'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'historial' && (
          <div>
            {cargandoHistorial ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Cargando facturas registradas...</div>
            ) : historial.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 10 }}>
                Aún no has cargado facturas de compra. Usa la pestaña <strong>"📸 Capturar / Analizar Factura"</strong> para ingresar tu primera factura.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {historial.map(f => {
                  const abierto = facturaExpandidaId === f.id;
                  return (
                    <div
                      key={f.id}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        background: '#fff',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        onClick={() => setFacturaExpandidaId(abierto ? null : f.id)}
                        style={{
                          padding: '0.8rem 1rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.75rem',
                          cursor: 'pointer',
                          background: abierto ? '#f8fafc' : '#fff',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                          {f.imagenFacturaUrl ? (
                            <img
                              src={f.imagenFacturaUrl}
                              alt={`Factura ${f.folio}`}
                              style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #cbd5e1' }}
                            />
                          ) : (
                            <div style={{ width: 44, height: 44, borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                              🧾
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                              Folio #{f.folio} — {f.razonSocialEmisor}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                              RUT: {f.rutEmisor || 'S/R'} · Fecha: {f.fechaEmision} · {f.totalUnidades} unid. ({f.actualizados} actualizados, {f.creados} nuevos)
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>{fmtCLP(f.totalNeto)} neto</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>c/IVA {fmtCLP(f.totalBruto)}</div>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{abierto ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {abierto && (
                        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                          <table style={{ width: '100%', fontSize: '0.76rem' }}>
                            <thead>
                              <tr>
                                <th>Acción</th>
                                <th>Código</th>
                                <th>Repuesto</th>
                                <th className="r">Stock Ant.</th>
                                <th className="r">+ Ingreso</th>
                                <th className="r">Stock Final</th>
                                <th className="r">Costo Neto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(f.items || []).map((it, idx) => (
                                <tr key={idx}>
                                  <td>
                                    <span
                                      style={{
                                        background: it.accion === 'CREADO' ? '#dcfce7' : '#dbeafe',
                                        color: it.accion === 'CREADO' ? '#166534' : '#1e40af',
                                        padding: '2px 6px',
                                        borderRadius: 4,
                                        fontWeight: 700,
                                        fontSize: '0.68rem',
                                      }}
                                    >
                                      {it.accion}
                                    </span>
                                  </td>
                                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{it.codigo}</td>
                                  <td>{it.nombre}</td>
                                  <td className="r">{it.stockAnterior}</td>
                                  <td className="r" style={{ fontWeight: 800, color: '#15803d' }}>+{it.cantidadSumada}</td>
                                  <td className="r" style={{ fontWeight: 800 }}>{it.stockFinal}</td>
                                  <td className="r">{fmtCLP(it.costoUnitarioNeto)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
