import Link from "next/link";

export const metadata = {
  title: "Términos de servicio",
  description: "Condiciones de uso de TrendinShop.",
};

const operatorName = process.env.LEGAL_ENTITY_NAME?.trim() || "el operador de TrendinShop";

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <div className="legal-container">
        <nav className="legal-nav"><Link href="/" className="legal-brand">TrendinShop</Link><Link href="/register">Volver al registro</Link></nav>
        <article className="legal-card">
          <span className="legal-kicker">INFORMACIÓN LEGAL</span>
          <h1>Términos de servicio</h1>
          <p className="legal-updated">Última actualización: 3 de noviembre de 2026</p>
          <section>
            <h2>1. Aceptación</h2>
            <p>Al crear una cuenta o utilizar TrendinShop aceptas estas condiciones y la Política de privacidad. Si no estás de acuerdo, no debes crear una cuenta ni utilizar el servicio.</p>
            <p>El servicio es operado por {operatorName}. Los datos de identificación y contacto del operador deben estar disponibles en la Política de privacidad.</p>
          </section>
          <section>
            <h2>2. Qué ofrece TrendinShop</h2>
            <p>TrendinShop es una herramienta para administrar catálogos, variantes, inventario, clientes, carritos compartidos, pedidos, ventas, pagos y cuentas comerciales. No es, por sí misma, una entidad financiera ni una pasarela de pago.</p>
            <p>Los carritos y pedidos enviados desde una tienda son solicitudes de compra. No representan un cobro, una reserva de inventario ni una aceptación definitiva de la operación. El revendedor debe confirmar disponibilidad, precio final, entrega y condiciones con el cliente.</p>
          </section>
          <section>
            <h2>3. Cuentas y seguridad</h2>
            <p>Debes proporcionar información veraz, mantener actualizados tus datos y proteger tu contraseña y sesión. Eres responsable de la actividad realizada desde tu cuenta. Debes notificar por el canal oficial de contacto si sospechas un acceso no autorizado.</p>
            <p>No puedes compartir credenciales, intentar acceder a cuentas ajenas, interferir con la plataforma ni utilizarla para actividades ilícitas o engañosas.</p>
          </section>
          <section>
            <h2>4. Responsabilidades de los revendedores</h2>
            <p>El revendedor es responsable de la exactitud de su catálogo, precios, descripciones, existencias, información de clientes, impuestos, cobros, entregas, garantías y cumplimiento de las obligaciones que le correspondan frente a sus compradores y proveedores.</p>
            <p>Cuando un revendedor completa un carrito compartido y registra una venta a nombre de un cliente, declara que cuenta con autorización para utilizar los datos personales introducidos y que la información es correcta.</p>
          </section>
          <section>
            <h2>5. Perfiles de clientes y carritos compartidos</h2>
            <p>Un visitante sin sesión puede navegar, preparar un carrito y compartirlo. Para enviar un pedido con los datos de una cuenta debe iniciar sesión. Para registrar una compra asistida, el dueño de la tienda debe iniciar sesión y completar los datos del cliente.</p>
            <p>Los perfiles de clientes creados por un revendedor no tienen contraseña ni constituyen cuentas de acceso. Su consulta queda limitada al directorio del revendedor que los registró. Los enlaces de carritos compartidos son transferibles a quien los reciba y caducan; compártelos únicamente con personas de confianza.</p>
          </section>
          <section>
            <h2>6. Disponibilidad y cambios</h2>
            <p>Podemos actualizar, mantener o modificar funciones para mejorar la seguridad y el funcionamiento del servicio. Aunque procuramos mantener la plataforma disponible y los datos consistentes, no garantizamos un servicio ininterrumpido ni que la información sustituya los registros contables o documentos que debas conservar por ley.</p>
          </section>
          <section>
            <h2>7. Suspensión y terminación</h2>
            <p>Podemos limitar o suspender el acceso cuando sea necesario para proteger a usuarios, datos o la plataforma, investigar un uso abusivo o cumplir una obligación legal. Puedes dejar de utilizar el servicio y solicitar la gestión de tus datos a través del canal de contacto del responsable.</p>
          </section>
          <section>
            <h2>8. Alcance y legislación aplicable</h2>
            <p>Estas condiciones deben interpretarse conforme a la legislación aplicable en el lugar donde opere el titular del servicio y se ofrezca TrendinShop. Antes del lanzamiento público, el operador debe completar la información legal y revisar estas condiciones con asesoría adecuada.</p>
          </section>
        </article>
      </div>
    </main>
  );
}
