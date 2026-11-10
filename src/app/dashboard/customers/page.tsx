"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@/lib/api/client";

type Customer = {
  _id: string;
  documentId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  createdAt?: string;
  updatedAt?: string;
};

type CustomerForm = Omit<Customer, "_id" | "createdAt" | "updatedAt">;
type CustomersResponse = { ok: true; customers: Customer[] };

const emptyForm: CustomerForm = {
  documentId: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  address: "",
};

function errorMessage(error: unknown) {
  const value = error as { response?: { data?: { message?: string } } };
  return value.response?.data?.message ?? "Ocurrió un error. Inténtalo de nuevo.";
}

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api.get<CustomersResponse>("/customers")).data.customers,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const documentTerm = term.replace(/[.\s-]/g, "");
    return (customers.data ?? []).filter((customer) =>
      [
        customer.documentId,
        customer.firstName,
        customer.lastName,
        customer.phone,
        customer.email,
        customer.address,
      ].some((value) => value.toLowerCase().includes(term)) ||
      customer.documentId.toLowerCase().includes(documentTerm),
    );
  }, [customers.data, search]);

  const saveCustomer = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return (await api.put("/customers/" + editingId, form)).data;
      }
      return (await api.post("/customers", form)).data;
    },
    onSuccess: async (result: { message?: string }) => {
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setError("");
      setSuccess(result.message ?? "Cliente guardado correctamente.");
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (requestError: unknown) => {
      setError(errorMessage(requestError));
      setSuccess("");
    },
  });

  const archiveCustomer = useMutation({
    mutationFn: async (customerId: string) => api.delete("/customers/" + customerId),
    onSuccess: async () => {
      setSuccess("Cliente archivado correctamente.");
      setError("");
      setFormOpen(false);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (requestError: unknown) => setError(errorMessage(requestError)),
  });

  function openCreateForm() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  function openEditForm(customer: Customer) {
    setEditingId(customer._id);
    setForm({
      documentId: customer.documentId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
    });
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  function updateField(field: keyof CustomerForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    saveCustomer.mutate();
  }

  return (
    <div className="dashboard-page customers-page">
      <section className="page-heading">
        <div>
          <span className="page-kicker">Relaciones comerciales</span>
          <h1>Clientes</h1>
          <p>Guarda los datos de tus clientes para encontrarlos rápidamente al registrar una venta.</p>
        </div>
        <button className="primary-button" type="button" onClick={openCreateForm}>
          <Plus size={17} /> Nuevo cliente
        </button>
      </section>

      <section className="customers-summary">
        <div className="customers-summary-icon"><UsersRound size={21} /></div>
        <div>
          <strong>{customers.data?.length ?? 0} {(customers.data?.length ?? 0) === 1 ? "cliente registrado" : "clientes registrados"}</strong>
          <span>Los registros son privados de tu cuenta. Puedes buscar a una persona por su cédula, nombre o teléfono.</span>
        </div>
      </section>

      {success ? <div className="customers-success"><Check size={16} /> {success}</div> : null}
      {error && !formOpen ? <div className="auth-error customers-message">{error}</div> : null}

      {formOpen ? (
        <section className="panel-card customers-form-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">{editingId ? "Actualizar ficha" : "Nuevo registro"}</span>
              <h2>{editingId ? "Editar cliente" : "Registrar cliente"}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Cerrar formulario"
              disabled={saveCustomer.isPending}
              onClick={() => { setFormOpen(false); setError(""); }}
            >
              <X size={18} />
            </button>
          </div>
          <form className="customers-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Cédula / documento *</span>
              <input value={form.documentId} onChange={(event) => updateField("documentId", event.target.value)} autoComplete="off" required maxLength={40} placeholder="Ej. V-12345678" />
            </label>
            <label className="field">
              <span>Nombre *</span>
              <input value={form.firstName} onChange={(event) => updateField("firstName", event.target.value)} autoComplete="given-name" required maxLength={100} placeholder="Nombre" />
            </label>
            <label className="field">
              <span>Apellido *</span>
              <input value={form.lastName} onChange={(event) => updateField("lastName", event.target.value)} autoComplete="family-name" required maxLength={100} placeholder="Apellido" />
            </label>
            <label className="field">
              <span>Teléfono *</span>
              <input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} autoComplete="tel" type="tel" required maxLength={40} placeholder="Ej. +1 555 123 4567" />
            </label>
            <label className="field">
              <span>Correo electrónico</span>
              <input value={form.email} onChange={(event) => updateField("email", event.target.value)} autoComplete="email" type="email" maxLength={200} placeholder="cliente@correo.com" />
            </label>
            <label className="field customers-address-field">
              <span>Dirección</span>
              <input value={form.address} onChange={(event) => updateField("address", event.target.value)} autoComplete="street-address" maxLength={300} placeholder="Dirección de entrega o contacto" />
            </label>
            {error ? <div className="auth-error customers-form-error">{error}</div> : null}
            <div className="customers-form-actions">
              <button className="secondary-button" type="button" disabled={saveCustomer.isPending} onClick={() => { setFormOpen(false); setError(""); }}>Cancelar</button>
              <button className="primary-button" type="submit" disabled={saveCustomer.isPending}>
                <Check size={15} /> {saveCustomer.isPending ? "Guardando..." : editingId ? "Guardar cambios" : "Crear cliente"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="customers-list-panel panel-card">
        <div className="customers-list-header">
          <div>
            <span className="panel-kicker">Directorio</span>
            <h2>Tu lista de clientes</h2>
          </div>
          <label className="search-field customers-search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cédula, nombre o teléfono..." aria-label="Buscar clientes" />
          </label>
        </div>

        {customers.isLoading ? (
          <div className="dashboard-loading">Cargando clientes...</div>
        ) : customers.isError ? (
          <div className="dashboard-empty compact">
            <div className="dashboard-empty-icon"><UsersRound size={19} /></div>
            <strong>No pudimos cargar los clientes</strong>
            <span>{errorMessage(customers.error)}</span>
            <button className="secondary-button" type="button" onClick={() => void customers.refetch()}>Intentar de nuevo</button>
          </div>
        ) : filtered.length ? (
          <div className="customers-list">
            {filtered.map((customer) => (
              <article className="customer-row" key={customer._id}>
                <div className="customer-avatar"><UserRound size={19} /></div>
                <div className="customer-main">
                  <div className="customer-name-line">
                    <strong>{customer.firstName} {customer.lastName}</strong>
                    <span className="customer-document">C.I. {customer.documentId}</span>
                  </div>
                  <div className="customer-details">
                    <span><Phone size={13} /> {customer.phone}</span>
                    {customer.email ? <span><Mail size={13} /> {customer.email}</span> : null}
                    {customer.address ? <span><MapPin size={13} /> {customer.address}</span> : null}
                  </div>
                </div>
                <div className="customer-actions">
                  <button className="secondary-button small-button" type="button" onClick={() => openEditForm(customer)}>
                    <Pencil size={13} /> Editar
                  </button>
                  <button
                    className="product-card-action danger"
                    type="button"
                    disabled={archiveCustomer.isPending}
                    onClick={() => {
                      if (window.confirm("¿Archivar a " + customer.firstName + " " + customer.lastName + "? El registro dejará de aparecer en tu directorio.")) {
                        setError("");
                        setSuccess("");
                        archiveCustomer.mutate(customer._id);
                      }
                    }}
                  >
                    <Trash2 size={13} /> Archivar
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty compact customers-empty">
            <div className="dashboard-empty-icon"><UsersRound size={19} /></div>
            <strong>{search ? "No encontramos coincidencias" : "Todavía no tienes clientes"}</strong>
            <span>{search ? "Prueba con otra cédula, nombre o teléfono." : "Registra a tu primer cliente. No necesita crear una cuenta para aparecer aquí."}</span>
            {!search ? <button className="secondary-action" type="button" onClick={openCreateForm}>Registrar primer cliente</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
