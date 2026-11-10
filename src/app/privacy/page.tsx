import Link from "next/link";

export const metadata = {
  title: "Política de privacidad",
  description: "Cómo TrendinShop utiliza y protege los datos personales.",
};

const operator = {
  name: process.env.LEGAL_ENTITY_NAME?.trim() || "",
  email: process.env.LEGAL_CONTACT_EMAIL?.trim() || "",
  address: process.env.LEGAL_ADDRESS?.trim() || "",
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <div className="legal-container">
        <nav className="legal-nav"><Link href="/" className="legal-brand">TrendinShop</Link><Link href="/register">Volver al registro</Link></nav>
        <article className="legal-card">
          <span className="legal-kicker">INFORMACIÓN LEGAL</span>
          <h1>Política de privacidad</h1>
          <p className="legal-updated">Última actualización: 3 de noviembre de 2026</p>
          <section>
            <h2>1. Responsable del tratamiento</h2>
            <p>La plataforma debe identificar claramente a la persona o entidad que opera TrendinShop antes de habilitar el registro público.</p>
            <div className="legal-operator">
              <strong>{operator.name || "Responsable pendiente de configurar"}</strong>
              {operator.address ? <span>{operator.address}</span> : null}
              {operator.email ? <a href={"mailto:" + operator.email}>{operator.email}</a> : null}
              {!operator.name || !operator.email || !operator.address ? <small>Configuración pendiente: define LEGAL_ENTITY_NAME, LEGAL_CONTACT_EMAIL y LEGAL_ADDRESS en el entorno de producción.</small> : null}
            </div>
          </section>
          <section>
            <h2>2. Datos que podemos tratar</h2>
            <p>Según las funciones que utilices, TrendinShop puede tratar datos de cuenta como nombre, apellido, cédula o documento de identidad, correo electrónico, teléfono, fecha de nacimiento y otros datos introducidos en el registro.</p>
            <p>Cuando un revendedor registra una compra asistida, puede guardar en su directorio los datos que el cliente le facilite, como documento de identidad, nombre, teléfono, correo y dirección de entrega, además de los productos, cantidades, importes y movimientos relacionados con la operación.</p>
            <p>Los carritos compartidos contienen referencias de productos, variantes y cantidades. El enlace compartido permite consultar ese carrito mientras esté vigente; no debe utilizarse para incluir datos personales.</p>
          </section>
          <section>
            <h2>3. Para qué utilizamos los datos</h2>
            <ul>
              <li>Crear y proteger cuentas, iniciar sesión y administrar permisos.</li>
              <li>Preparar catálogos, carritos, pedidos, ventas, pagos e historiales.</li>
              <li>Permitir que un revendedor gestione la relación comercial con sus propios clientes.</li>
              <li>Prevenir abuso, fraude, accesos no autorizados y solicitudes automatizadas.</li>
              <li>Mantener la seguridad, disponibilidad y funcionamiento de la plataforma.</li>
            </ul>
          </section>
          <section>
            <h2>4. Perfiles de clientes sin cuenta</h2>
            <p>Una persona puede armar y compartir un carrito sin iniciar sesión. En ese caso no puede enviar directamente un pedido ni consultar perfiles mediante su documento de identidad. El revendedor debe iniciar sesión, recibir el carrito compartido y completar los datos del cliente para registrar la venta.</p>
            <p>El perfil de cliente que se guarda de esta forma no tiene contraseña ni permite iniciar sesión. Se conserva para que el mismo revendedor pueda recuperar los datos desde su directorio en futuras compras. Si esa persona se registra posteriormente, los datos introducidos en su nuevo registro se vinculan al perfil existente.</p>
          </section>
          <section>
            <h2>5. Cuándo se comparten los datos</h2>
            <p>Los datos de una compra se muestran al revendedor que administra la tienda donde se gestiona esa compra. TrendinShop también puede utilizar proveedores tecnológicos necesarios para alojar la aplicación, almacenar información y prestar el servicio. Los datos podrán comunicarse cuando exista una obligación legal válida.</p>
            <p>Un revendedor no debe introducir datos de otra persona sin contar con autorización y una base legítima para utilizarlos. La casilla de confirmación de compra asistida registra la declaración del revendedor; no sustituye la obligación de obtener la autorización necesaria del cliente.</p>
          </section>
          <section>
            <h2>6. Conservación y seguridad</h2>
            <p>Los datos se conservan mientras sean necesarios para prestar el servicio, mantener el historial comercial y atender obligaciones legales aplicables. TrendinShop aplica controles técnicos y organizativos para proteger sesiones, restringir el acceso a los datos y limitar solicitudes abusivas. Ningún sistema conectado a Internet puede garantizar seguridad absoluta.</p>
          </section>
          <section>
            <h2>7. Derechos y solicitudes</h2>
            <p>La persona interesada puede solicitar acceso, corrección o eliminación de sus datos, así como plantear preguntas sobre su tratamiento, mediante el canal de contacto del responsable indicado arriba. Los revendedores deben atender las solicitudes relativas a los datos que administran en su propia relación comercial, sin perjuicio de las obligaciones del operador de la plataforma.</p>
          </section>
          <section>
            <h2>8. Cambios en esta política</h2>
            <p>Esta política puede actualizarse para reflejar cambios en la plataforma o en los requisitos aplicables. La fecha de actualización se modificará cuando se publique una nueva versión.</p>
          </section>
          <p className="legal-footnote">Esta política es una base operativa y debe revisarse y completarse con los datos legales del operador y los requisitos del país donde se ofrecerá TrendinShop.</p>
        </article>
      </div>
    </main>
  );
}
