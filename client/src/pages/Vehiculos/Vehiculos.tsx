import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";
import { vehiculosService } from "../../services/vehiculos";
import { useVehiculo } from "../../hooks/useVehiculo";
import {
  validarEmail,
  validarTelefonoChileno,
  errorTelefono,
  errorEmail,
  formatRut,
} from "../../utils/validaciones";
import type { Vehiculo } from "../../types";
import Pagination from '../../components/ui/Pagination';
import { usePagination } from '../../hooks/usePagination';
import styles from './Vehiculos.module.css';

export default function Vehiculos() {
  const navigate = useNavigate();
  const { vehiculos, setVehiculos, cotizaciones, ordenes, setLoading, notify } =
    useAppStore();
  const {
    buscando,
    encontrado,
    error: apiError,
    buscarPatente,
  } = useVehiculo();
  const [search, setSearch] = useState("");
  const [modalNuevo, setModalNuevo] = useState(false);
  const [modalEditar, setModalEditar] = useState<Vehiculo | null>(null);

  const [patente, setPatente] = useState("");
  const [make, setMake]       = useState("");
  const [model, setModel]     = useState("");
  const [year, setYear]       = useState("");
  const [type, setType]       = useState("");
  const [engine, setEngine]   = useState("");
  const [owner, setOwner]     = useState("");
  const [rut, setRut]         = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail]     = useState("");
  const [km, setKm]           = useState("");   // ← nuevo
  const [errorTel, setErrorTel]   = useState("");
  const [errorMail, setErrorMail] = useState("");

  useEffect(() => {
    loadVehiculos();
  }, []);

  const loadVehiculos = async () => {
    setLoading(true);
    try {
      const res = await vehiculosService.getAll();
      if (res.success && res.data) setVehiculos(res.data);
    } catch {
      notify("Error al cargar vehículos", "error");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setPatente(""); setMake(""); setModel(""); setYear("");
    setType(""); setEngine(""); setOwner(""); setRut(""); setTelefono("");
    setEmail(""); setKm("");
    setErrorTel(""); setErrorMail("");
  };

  const handlePatenteBlur = async () => {
    if (!patente || patente.length < 5) return;
    const data = await buscarPatente(patente);
    if (data) {
      setMake(data.make);
      setModel(data.model);
      setYear(data.year);
      setType(data.type);
      setEngine(data.engine);
    }
  };

  const handleSave = async () => {
    if (!patente && !modalEditar) {
      notify("Ingresa la patente", "error");
      return;
    }
    if (!owner) {
      notify("Ingresa el nombre del propietario", "error");
      return;
    }
    if (telefono && !validarTelefonoChileno(telefono)) {
      notify(errorTelefono, "error");
      return;
    }
    if (email && !validarEmail(email)) {
      notify(errorEmail, "error");
      return;
    }

    setLoading(true);
    try {
      const data: Vehiculo = {
        patente: modalEditar ? modalEditar.patente : patente.toUpperCase(),
        make, model, year, type, engine, owner, telefono, email,
        rut: rut || undefined,
        km: km || undefined,   // ← nuevo
      };
      if (modalEditar) {
        await vehiculosService.update(modalEditar.patente, data);
        notify("Vehículo actualizado ✓", "success");
        setModalEditar(null);
      } else {
        await vehiculosService.create(data);
        notify("Vehículo guardado ✓", "success");
        setModalNuevo(false);
      }
      resetForm();
      loadVehiculos();
    } catch {
      notify("Error al guardar", "error");
    } finally {
      setLoading(false);
    }
  };

  const openEditar = (v: Vehiculo) => {
    setModalEditar(v);
    setMake(v.make || "");  setModel(v.model || "");
    setYear(v.year || "");  setType(v.type || "");
    setEngine(v.engine || ""); setOwner(v.owner || "");
    setRut(v.rut || "");
    setTelefono(v.telefono || ""); setEmail(v.email || "");
    setKm(v.km || "");   // ← nuevo
    setErrorTel(""); setErrorMail("");
  };

  // navState — incluye km para pre-cargar en Cotización/OT
  const navState = (v: Vehiculo) => ({
    patente: v.patente,
    make: v.make,  model: v.model, year: v.year,
    type: v.type,  engine: v.engine, owner: v.owner,
    telefono: v.telefono, email: v.email,
    rut: v.rut || "",
    km: v.km || "",   // ← nuevo
  });

  const filtered = vehiculos.filter((v) => {
    const q = search.toLowerCase();
    return (
      !q ||
      v.patente.toLowerCase().includes(q) ||
      (v.make || "").toLowerCase().includes(q) ||
      (v.owner || "").toLowerCase().includes(q) ||
      (v.rut || "").toLowerCase().includes(q)
    );
  });
  const { paged, page, pageSize, totalPages, goTo, changeSize } = usePagination(filtered);

  const vehicleForm = (isEditar: boolean) => (
    <>
      {!isEditar && (
        <div className={`form-grid fg-13 ${styles.mb08}`}>
          <div className="field">
            <label>Patente *</label>
            <input
              className="patente-input"
              value={patente}
              maxLength={8}
              onChange={(e) => setPatente(e.target.value.toUpperCase())}
              onBlur={handlePatenteBlur}
              placeholder="ABCD12"
            />
          </div>
          <div className={styles.apiStatusWrap}>
            <div className="api-status">
              <div className={`api-dot ${buscando ? "loading" : encontrado ? "ok" : apiError ? "err" : ""}`} />
              <span>
                {buscando ? "Consultando..." : encontrado ? "✓ Autocargado" : "Ingresa la patente"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Datos del vehículo */}
      <div className="form-grid fg-2">
        <div className="field">
          <label>Marca</label>
          <input value={make} onChange={e => setMake(e.target.value)} placeholder="HONDA" />
        </div>
        <div className="field">
          <label>Modelo</label>
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="HRV" />
        </div>
      </div>
      <div className={`form-grid fg-3 ${styles.mt08}`}>
        <div className="field">
          <label>Año</label>
          <input value={year} onChange={e => setYear(e.target.value)} />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="">— Seleccionar —</option>
            <option value="AUTOMOVIL">Automóvil</option>
            <option value="STATION WAGON">Station Wagon</option>
            <option value="SUV">SUV / Todo Terreno</option>
            <option value="CAMIONETA">Camioneta</option>
            <option value="FURGON">Furgón</option>
            <option value="MINIBUS">Minibus</option>
            <option value="BUS">Bus</option>
            <option value="PICKUP">Pick-Up</option>
            <option value="VAN">Van</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
        <div className="field">
          <label>N° Motor</label>
          <input value={engine} onChange={e => setEngine(e.target.value)} />
        </div>
      </div>

      {/* Kilometraje */}
      <div className={`form-grid fg-2 ${styles.mt08}`}>
        <div className="field">
          <label>Kilometraje Actual</label>
          <input
            type="number"
            min={0}
            value={km}
            onChange={e => setKm(e.target.value)}
            placeholder="Ej: 85000"
          />
          <span className="field-hint">Se actualiza automáticamente con cada OT</span>
        </div>
      </div>

      <div className="modal-sep" />

      {/* Datos del cliente */}
      <div className={styles.sectionTitle}>
        <span className={styles.sectionTitleBar} />
        Datos del Cliente
      </div>

      <div className={styles.infoBanner}>
        ℹ El nombre, teléfono y correo solo se pueden modificar desde el perfil del vehículo.
      </div>

      <div className={`form-grid fg-2 ${styles.mb08}`}>
        <div className="field">
          <label>Nombre Propietario *</label>
          <input
            value={owner}
            onChange={e => setOwner(e.target.value.toUpperCase())}
            placeholder="NOMBRE APELLIDO"
          />
        </div>
        <div className="field">
          <label>RUT (opcional, para factura)</label>
          <input
            value={rut}
            onChange={e => setRut(formatRut(e.target.value))}
            placeholder="12.345.678-9"
            maxLength={12}
          />
        </div>
      </div>

      <div className="form-grid fg-2">
        <div className="field">
          <label>Teléfono</label>
          <input
            value={telefono}
            onChange={e => { setTelefono(e.target.value); setErrorTel(""); }}
            onBlur={() => { if (telefono && !validarTelefonoChileno(telefono)) setErrorTel(errorTelefono); }}
            placeholder="9 XXXX XXXX"
            className={errorTel ? styles.inputError : ''}
          />
          {errorTel && <span className={styles.fieldError}>{errorTel}</span>}
        </div>
        <div className="field">
          <label>Correo</label>
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setErrorMail(""); }}
            onBlur={() => { if (email && !validarEmail(email)) setErrorMail(errorEmail); }}
            placeholder="correo@mail.com"
            className={errorMail ? styles.inputError : ''}
          />
          {errorMail && <span className={styles.fieldError}>{errorMail}</span>}
        </div>
      </div>
    </>
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Perfiles de <span>Vehículos</span></div>
        <div className={styles.toolbarRight}>
          <input
            type="text"
            placeholder="Buscar patente, marca, propietario, RUT..."
            className={styles.searchInput}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => { resetForm(); setModalNuevo(true); }}>
            + Nuevo Vehículo
          </button>
        </div>
      </div>

      <Pagination
        page={page} totalPages={totalPages} totalItems={filtered.length}
        pageSize={pageSize} onPage={goTo} onPageSize={changeSize}
      />
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Patente</th>
              <th>Marca / Modelo</th>
              <th>Año</th>
              <th>Tipo</th>
              <th>Motor</th>
              <th>KM</th>
              <th>Propietario</th>
              <th>Tel.</th>
              <th>Cot.</th>
              <th>OT</th>
              <th className={styles.thAcciones}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className={styles.emptyRow}>No hay vehículos registrados</td>
              </tr>
            )}
            {paged.map(v => {
              const numCots = cotizaciones.filter(c => c.patente === v.patente).length;
              const numOTs  = ordenes.filter(o => o.patente === v.patente).length;
              return (
                <tr key={v.patente}>
                  <td data-label="Patente" className="patente-cell">{v.patente}</td>
                  <td data-label="Marca / Modelo">
                    <div className={styles.cellBold}>{v.make} {v.model}</div>
                  </td>
                  <td data-label="Año">{v.year || "—"}</td>
                  <td data-label="Tipo" className={styles.cellMuted}>{v.type || "—"}</td>
                  <td data-label="Motor" className="hide-mobile">{v.engine || "—"}</td>
                  <td data-label="KM" className={styles.cellKm}>
                    {v.km ? Number(v.km).toLocaleString("es-CL") + " km" : "—"}
                  </td>
                  <td data-label="Propietario">
                    <div className={styles.cellBold}>{v.owner || "—"}</div>
                    {v.rut && <div className={styles.cellRut}>{v.rut}</div>}
                    {v.email && <div className={styles.cellEmail}>{v.email}</div>}
                  </td>
                  <td data-label="Tel." className="hide-mobile">{v.telefono || "—"}</td>
                  <td data-label="Cot."><span className="badge badge-pending">{numCots}</span></td>
                  <td data-label="OT"><span className="badge badge-recibido">{numOTs}</span></td>
                  <td data-label="Acciones" className={styles.tdAcciones}>
                    <div className={styles.accionesCol}>
                      <button className="btn btn-dark btn-sm" onClick={() => navigate(`/vehiculos/${v.patente}`)}>
                        👁 Ver Perfil
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => navigate("/cotizaciones/nueva", { state: navState(v) })}>
                        + Cotización
                      </button>
                      <button className="btn btn-dark btn-sm" onClick={() => navigate("/ordenes/nueva", { state: navState(v) })}>
                        + OT
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => openEditar(v)}>
                        ✏ Editar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Nuevo */}
      {modalNuevo && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">Nuevo Vehículo</div>
            {vehicleForm(false)}
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => { setModalNuevo(false); resetForm(); }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar */}
      {modalEditar && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-title">Editando {modalEditar.patente}</div>
            {vehicleForm(true)}
            <div className="modal-actions">
              <button className="btn btn-dark" onClick={() => { setModalEditar(null); resetForm(); }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Guardar Cambios</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}