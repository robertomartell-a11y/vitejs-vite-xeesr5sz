import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from "lucide-react";

/* ╔══════════════════════════════════════════════════════════════════════╗
   ║  1) PEGA AQUÍ TUS CLAVES DE SUPABASE                                 ║
   ║     Supabase → Project Settings → API                                ║
   ║     Usa la clave "anon / public". NUNCA pegues la "service_role".    ║
   ╚══════════════════════════════════════════════════════════════════════╝ */
const SUPABASE_URL = "https://njrhwojdttnbshhztyqp.supabase.co"; // ej. https://abcdefgh.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_9ri1U4PhUUOBsbK3bkX0Ng_RrNGN30c";

/* ──────────────────────────────────────────────────────────────────────────
   2) SQL PARA PREPARAR SUPABASE (ejecutar una sola vez en el SQL Editor)

   create table public.obligaciones (
     id uuid primary key default gen_random_uuid(),
     titulo text not null,
     folio text,
     categoria text not null
       check (categoria in ('Ambiental ASEA','Operativo CRE','Fiscal SAT')),
     anio int not null check (anio between 2018 and 2026),
     estatus text not null default 'Pendiente'
       check (estatus in ('Cumplido','Pendiente','Vencido')),
     fundamento_juridico text,
     archivo_pdf_url text,
     created_at timestamptz not null default now()
   );

   alter table public.obligaciones enable row level security;

   -- Visitantes: solo lectura
   create policy "lectura publica" on public.obligaciones
     for select using (true);

   -- Administrador (usuario con sesión): alta y cambio de estatus
   create policy "admin inserta" on public.obligaciones
     for insert to authenticated with check (true);
   create policy "admin actualiza" on public.obligaciones
     for update to authenticated using (true) with check (true);

   -- Bucket público para los PDF
   insert into storage.buckets (id, name, public)
     values ('documentos-regulatorios', 'documentos-regulatorios', true)
     on conflict (id) do nothing;

   create policy "admin sube pdf" on storage.objects
     for insert to authenticated
     with check (bucket_id = 'documentos-regulatorios');

   IMPORTANTE: en Authentication → Sign In / Providers desactiva
   "Allow new users to sign up" y crea tu usuario administrador a mano en
   Authentication → Users. Si dejas el registro abierto, cualquiera podría
   crearse una cuenta y tendría permisos de administrador.
   ────────────────────────────────────────────────────────────────────────── */

/* ============================ Configuración ============================ */

const TABLA = "obligaciones";
const BUCKET = "documentos-regulatorios";
const MAX_PDF_MB = 20;

const ANIOS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
const CATEGORIAS = ["Ambiental ASEA", "Operativo CRE", "Fiscal SAT"] as const;
const ESTATUS = ["Cumplido", "Pendiente", "Vencido"] as const;

type Categoria = (typeof CATEGORIAS)[number];
type Estatus = (typeof ESTATUS)[number];

interface Obligacion {
  id: string;
  titulo: string;
  folio: string | null;
  categoria: Categoria;
  anio: number;
  estatus: Estatus;
  fundamento_juridico: string | null;
  archivo_pdf_url: string | null;
  created_at: string;
}

const configurado =
  /^https:\/\/.+/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.startsWith("PEGA_AQUI");

const supabase = createClient(
  configurado ? SUPABASE_URL : "https://sin-configurar.supabase.co",
  configurado ? SUPABASE_ANON_KEY : "sin-configurar"
);

/* Colores de marca RYO */
const ORO = "#C5A059";

/* ============================== Utilidades ============================== */

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const esUrlSegura = (url: string | null): url is string => !!url && /^https?:\/\//i.test(url);

const nombreSeguro = (nombre: string) =>
  normalizar(nombre)
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-80);

/* ============================== Componentes ============================== */

function Modal({
  titulo,
  onClose,
  children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A1931]/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold tracking-wide text-[#0A1931]">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

const claseInput =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#C5A059] focus:ring-2 focus:ring-[#C5A059]/30";
const claseLabel = "mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500";
const claseBotonOro =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[#C5A059] px-4 py-2 text-sm font-semibold text-[#0A1931] shadow-sm transition hover:bg-[#b38f4b] disabled:cursor-not-allowed disabled:opacity-60";

function MensajeError({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{texto}</span>
    </p>
  );
}

/* ------------------------------ Login admin ------------------------------ */

function ModalLogin({ onClose }: { onClose: () => void }) {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCargando(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: correo.trim(),
      password: clave,
    });
    setCargando(false);
    if (err) {
      setError("No fue posible iniciar sesión. Verifica el correo y la contraseña.");
      return;
    }
    onClose();
  };

  return (
    <Modal titulo="Acceso de administrador" onClose={onClose}>
      <form onSubmit={entrar} className="space-y-4">
        <div>
          <label className={claseLabel} htmlFor="correo">
            Correo
          </label>
          <input
            id="correo"
            type="email"
            required
            autoFocus
            autoComplete="username"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            className={claseInput}
          />
        </div>
        <div>
          <label className={claseLabel} htmlFor="clave">
            Contraseña
          </label>
          <input
            id="clave"
            type="password"
            required
            autoComplete="current-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className={claseInput}
          />
        </div>
        {error && <MensajeError texto={error} />}
        <button type="submit" disabled={cargando} className={`${claseBotonOro} w-full`}>
          {cargando ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
          Iniciar sesión
        </button>
      </form>
    </Modal>
  );
}

/* --------------------------- Nueva obligación --------------------------- */

function ModalNuevaObligacion({
  onClose,
  onCreada,
}: {
  onClose: () => void;
  onCreada: (o: Obligacion) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [folio, setFolio] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("Ambiental ASEA");
  const [anio, setAnio] = useState<number>(ANIOS[0]);
  const [estatus, setEstatus] = useState<Estatus>("Pendiente");
  const [fundamento, setFundamento] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const elegirArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError("");
    if (f && f.type !== "application/pdf") {
      setError("El archivo debe ser un PDF.");
      e.target.value = "";
      setArchivo(null);
      return;
    }
    if (f && f.size > MAX_PDF_MB * 1024 * 1024) {
      setError(`El PDF excede el límite de ${MAX_PDF_MB} MB.`);
      e.target.value = "";
      setArchivo(null);
      return;
    }
    setArchivo(f);
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setGuardando(true);

    let rutaSubida: string | null = null;
    let urlPublica: string | null = null;

    try {
      if (archivo) {
        rutaSubida = `${anio}/${Date.now()}-${nombreSeguro(archivo.name)}`;
        const { error: errSubida } = await supabase.storage
          .from(BUCKET)
          .upload(rutaSubida, archivo, { contentType: "application/pdf", upsert: false });
        if (errSubida) throw new Error(`No se pudo subir el PDF: ${errSubida.message}`);
        urlPublica = supabase.storage.from(BUCKET).getPublicUrl(rutaSubida).data.publicUrl;
      }

      const { data, error: errInsert } = await supabase
        .from(TABLA)
        .insert({
          titulo: titulo.trim(),
          folio: folio.trim() || null,
          categoria,
          anio,
          estatus,
          fundamento_juridico: fundamento.trim() || null,
          archivo_pdf_url: urlPublica,
        })
        .select()
        .single();

      if (errInsert) {
        // Si falló el registro, se intenta retirar el PDF para no dejar archivos huérfanos.
        if (rutaSubida) await supabase.storage.from(BUCKET).remove([rutaSubida]);
        throw new Error(`No se pudo guardar la obligación: ${errInsert.message}`);
      }

      onCreada(data as Obligacion);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo="Nueva obligación" onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <div>
          <label className={claseLabel} htmlFor="titulo">
            Obligación
          </label>
          <input
            id="titulo"
            required
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Nombre de la obligación o trámite"
            className={claseInput}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={claseLabel} htmlFor="folio">
              Folio
            </label>
            <input
              id="folio"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="Folio, bitácora o número de oficio"
              className={claseInput}
            />
          </div>
          <div>
            <label className={claseLabel} htmlFor="categoria">
              Categoría
            </label>
            <select
              id="categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as Categoria)}
              className={claseInput}
            >
              {CATEGORIAS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={claseLabel} htmlFor="anio">
              Año
            </label>
            <select
              id="anio"
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className={claseInput}
            >
              {ANIOS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={claseLabel} htmlFor="estatus">
              Estatus
            </label>
            <select
              id="estatus"
              value={estatus}
              onChange={(e) => setEstatus(e.target.value as Estatus)}
              className={claseInput}
            >
              {ESTATUS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={claseLabel} htmlFor="fundamento">
            Fundamento jurídico
          </label>
          <textarea
            id="fundamento"
            rows={4}
            value={fundamento}
            onChange={(e) => setFundamento(e.target.value)}
            placeholder="Disposición, artículo o numeral aplicable"
            className={claseInput}
          />
        </div>

        <div>
          <label className={claseLabel} htmlFor="pdf">
            Documento PDF (opcional, máx. {MAX_PDF_MB} MB)
          </label>
          <label
            htmlFor="pdf"
            className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-slate-300 bg-[#F4F6F9] px-3 py-3 text-sm text-slate-600 hover:border-[#C5A059]"
          >
            <Upload size={18} className="shrink-0 text-[#C5A059]" />
            <span className="truncate">{archivo ? archivo.name : "Seleccionar archivo PDF"}</span>
          </label>
          <input id="pdf" type="file" accept="application/pdf" onChange={elegirArchivo} className="sr-only" />
        </div>

        {error && <MensajeError texto={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className={claseBotonOro}>
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {guardando ? "Guardando…" : "Guardar obligación"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------- Tarjeta de obligación --------------------------- */

function Tarjeta({
  o,
  esAdmin,
  actualizando,
  onCambiarEstatus,
}: {
  o: Obligacion;
  esAdmin: boolean;
  actualizando: boolean;
  onCambiarEstatus: (o: Obligacion) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const cumplido = o.estatus === "Cumplido";

  const claseEstatus = cumplido
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : o.estatus === "Vencido"
    ? "bg-red-50 text-red-700 ring-red-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";

  return (
    <article className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-block rounded-full bg-[#0A1931]/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#0A1931]">
              {o.categoria}
            </span>
            <h3 className="mt-2 text-base font-bold leading-snug text-[#0A1931]">{o.titulo}</h3>
            <p className="mt-1 break-words font-mono text-xs text-slate-500">Folio: {o.folio || "Sin folio"}</p>
          </div>
          {cumplido ? (
            <CheckCircle2 size={40} className="shrink-0 text-emerald-600" aria-label="Cumplido" />
          ) : (
            <XCircle size={40} className="shrink-0 text-red-600" aria-label={o.estatus} />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset ${claseEstatus}`}>
            {o.estatus}
          </span>
          <span className="rounded-full bg-[#F4F6F9] px-2.5 py-0.5 font-medium text-slate-600">{o.anio}</span>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-[#0A1931]"
          >
            <span className="flex items-center gap-2">
              <Scale size={14} className="text-[#C5A059]" />
              Fundamento jurídico
            </span>
            <ChevronDown size={16} className={`transition-transform ${abierto ? "rotate-180" : ""}`} />
          </button>
          {abierto && (
            <p className="mt-2 whitespace-pre-line rounded-md border-l-2 border-[#C5A059] bg-[#F4F6F9] px-3 py-2 text-sm leading-relaxed text-slate-700">
              {o.fundamento_juridico || "Sin fundamento jurídico registrado."}
            </p>
          )}
        </div>
      </div>

      {(esUrlSegura(o.archivo_pdf_url) || esAdmin) && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {esUrlSegura(o.archivo_pdf_url) && (
            <a
              href={o.archivo_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-[#0A1931] px-3 py-2 text-xs font-semibold text-[#C5A059] transition hover:bg-[#12284d]"
            >
              <Download size={14} />
              Descargar PDF
            </a>
          )}
          {esAdmin && (
            <button
              type="button"
              onClick={() => onCambiarEstatus(o)}
              disabled={actualizando}
              className="inline-flex items-center gap-2 rounded-md border border-[#C5A059] px-3 py-2 text-xs font-semibold text-[#8a6d2f] transition hover:bg-[#C5A059]/10 disabled:opacity-60"
            >
              {actualizando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Marcar como {cumplido ? "Pendiente" : "Cumplido"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ================================ App ================================ */

export default function App() {
  const [obligaciones, setObligaciones] = useState<Obligacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [anio, setAnio] = useState<number | "Todos">("Todos");
  const [categoria, setCategoria] = useState<Categoria | "Todas">("Todas");
  const [busqueda, setBusqueda] = useState("");

  const [sesion, setSesion] = useState<Session | null>(null);
  const [verLogin, setVerLogin] = useState(false);
  const [verNueva, setVerNueva] = useState(false);
  const [actualizandoId, setActualizandoId] = useState<string | null>(null);

  const esAdmin = !!sesion;

  /* Sesión */
  useEffect(() => {
    if (!configurado) return;
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  /* Carga de obligaciones */
  const cargar = useCallback(async () => {
    if (!configurado) {
      setCargando(false);
      return;
    }
    setCargando(true);
    setError("");
    const { data, error: err } = await supabase
      .from(TABLA)
      .select("*")
      .order("anio", { ascending: false })
      .order("created_at", { ascending: false });
    if (err) setError(`No se pudieron cargar las obligaciones: ${err.message}`);
    else setObligaciones((data ?? []) as Obligacion[]);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /* Filtros */
  const filtradas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return obligaciones.filter((o) => {
      if (anio !== "Todos" && o.anio !== anio) return false;
      if (categoria !== "Todas" && o.categoria !== categoria) return false;
      if (!q) return true;
      return normalizar(
        [o.titulo, o.folio, o.fundamento_juridico, o.categoria, o.estatus].filter(Boolean).join(" ")
      ).includes(q);
    });
  }, [obligaciones, anio, categoria, busqueda]);

  const resumen = useMemo(
    () => ({
      total: filtradas.length,
      cumplidas: filtradas.filter((o) => o.estatus === "Cumplido").length,
      pendientes: filtradas.filter((o) => o.estatus === "Pendiente").length,
      vencidas: filtradas.filter((o) => o.estatus === "Vencido").length,
    }),
    [filtradas]
  );

  /* Acciones de administrador */
  const cambiarEstatus = async (o: Obligacion) => {
    const nuevo: Estatus = o.estatus === "Cumplido" ? "Pendiente" : "Cumplido";
    setActualizandoId(o.id);
    setError("");
    const { error: err } = await supabase.from(TABLA).update({ estatus: nuevo }).eq("id", o.id);
    if (err) setError(`No se pudo actualizar el estatus: ${err.message}`);
    else setObligaciones((lista) => lista.map((x) => (x.id === o.id ? { ...x, estatus: nuevo } : x)));
    setActualizandoId(null);
  };

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    setVerNueva(false);
  };

  const claseFiltro = (activo: boolean) =>
    `w-full rounded-r-md border-l-2 px-3 py-2 text-left text-sm transition ${
      activo
        ? "border-[#C5A059] bg-white/10 font-semibold text-white"
        : "border-transparent text-slate-300 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <div className="flex h-screen overflow-hidden bg-[#F4F6F9] font-sans text-slate-800">
      {/* ───────────── Barra lateral fija ───────────── */}
      <aside className="flex w-64 shrink-0 flex-col justify-between bg-[#0A1931] text-white">
        <div>
          <div className="border-b border-white/10 px-6 py-6">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"
                style={{ borderColor: ORO }}
              >
                <ShieldCheck size={20} style={{ color: ORO }} />
              </div>
              <div>
                <p className="font-serif text-xl font-bold leading-none tracking-wide text-white">
                  RYO <span style={{ color: ORO }}>Control</span>
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">Gestión Especializada</p>
              </div>
            </div>
            <p className="mt-4 text-[9px] uppercase tracking-[0.18em]" style={{ color: ORO }}>
              Regulación · Energía · Cumplimiento
            </p>
          </div>

          <nav className="px-3 py-5">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Autoridad</p>
            <div className="space-y-1">
              {(["Todas", ...CATEGORIAS] as const).map((c) => (
                <button key={c} type="button" onClick={() => setCategoria(c)} className={claseFiltro(categoria === c)}>
                  {c}
                </button>
              ))}
            </div>
          </nav>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
          {esAdmin ? (
            <>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: ORO }}>
                  Administrador
                </p>
                <p className="truncate text-xs text-slate-300">{sesion?.user.email}</p>
              </div>
              <button
                type="button"
                onClick={cerrarSesion}
                title="Cerrar sesión"
                className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#C5A059] hover:text-white"
              >
                <LogOut size={14} />
                Salir
              </button>
            </>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Modo visitante</p>
              <button
                type="button"
                onClick={() => setVerLogin(true)}
                title="Acceso de administrador"
                aria-label="Acceso de administrador"
                className="rounded p-1.5 text-slate-500 transition hover:text-[#C5A059]"
              >
                <Lock size={14} />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ───────────── Área principal ───────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Barra superior */}
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-[#0A1931]">Obligaciones Regulatorias</h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {categoria === "Todas" ? "Todas las autoridades" : categoria} ·{" "}
                {anio === "Todos" ? "2018 a 2026" : anio}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="relative w-80">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por obligación, folio o fundamento"
                  aria-label="Buscar obligaciones"
                  className={`${claseInput} pl-9`}
                />
              </div>
              {esAdmin && (
                <button type="button" onClick={() => setVerNueva(true)} className={`${claseBotonOro} whitespace-nowrap`}>
                  <Plus size={16} />
                  Nueva Obligación
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Año</span>
            {(["Todos", ...[...ANIOS].reverse()] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAnio(a)}
                aria-pressed={anio === a}
                className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition ${
                  anio === a
                    ? "border-[#C5A059] bg-[#C5A059] text-[#0A1931]"
                    : "border-slate-300 bg-white text-slate-600 hover:border-[#C5A059] hover:text-[#0A1931]"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </header>

        {/* Indicadores */}
        <section className="grid grid-cols-4 gap-4 px-8 pt-6">
          {[
            { etiqueta: "Total", valor: resumen.total, color: "text-[#0A1931]", borde: "border-l-[#0A1931]" },
            { etiqueta: "Cumplidas", valor: resumen.cumplidas, color: "text-emerald-600", borde: "border-l-emerald-500" },
            { etiqueta: "Pendientes", valor: resumen.pendientes, color: "text-amber-600", borde: "border-l-amber-500" },
            { etiqueta: "Vencidas", valor: resumen.vencidas, color: "text-red-600", borde: "border-l-red-500" },
          ].map((r) => (
            <div
              key={r.etiqueta}
              className={`rounded-xl border border-l-4 border-slate-200 bg-white px-5 py-4 shadow-sm ${r.borde}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{r.etiqueta}</p>
              <p className={`mt-1 text-3xl font-bold tabular-nums ${r.color}`}>{r.valor}</p>
            </div>
          ))}
        </section>

        {(!configurado || error) && (
          <div className="space-y-3 px-8 pt-6">
            {!configurado && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>
                  Falta configurar Supabase. Pega tus claves en las constantes <code>SUPABASE_URL</code> y{" "}
                  <code>SUPABASE_ANON_KEY</code> al inicio de <code>App.tsx</code>.
                </p>
              </div>
            )}
            {error && <MensajeError texto={error} />}
          </div>
        )}

        {/* Tarjetas */}
        {cargando ? (
          <div className="flex items-center justify-center gap-3 p-8 py-20 text-sm text-slate-500">
            <Loader2 size={20} className="animate-spin text-[#C5A059]" />
            Cargando obligaciones…
          </div>
        ) : filtradas.length === 0 ? (
          <div className="p-8">
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <FileText size={32} className="mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-[#0A1931]">
                {obligaciones.length === 0 ? "Aún no hay obligaciones registradas" : "Sin resultados"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {obligaciones.length === 0
                  ? "Las obligaciones aparecerán aquí en cuanto se registren."
                  : "Ajusta el año, la autoridad o el texto de búsqueda."}
              </p>
            </div>
          </div>
        ) : (
          <section className="grid grid-cols-1 items-start gap-6 p-8 md:grid-cols-2 lg:grid-cols-3">
            {filtradas.map((o) => (
              <Tarjeta
                key={o.id}
                o={o}
                esAdmin={esAdmin}
                actualizando={actualizandoId === o.id}
                onCambiarEstatus={cambiarEstatus}
              />
            ))}
          </section>
        )}
      </main>

      {verLogin && !esAdmin && <ModalLogin onClose={() => setVerLogin(false)} />}
      {verNueva && esAdmin && (
        <ModalNuevaObligacion
          onClose={() => setVerNueva(false)}
          onCreada={(o) => setObligaciones((lista) => [o, ...lista])}
        />
      )}
    </div>
  );
}