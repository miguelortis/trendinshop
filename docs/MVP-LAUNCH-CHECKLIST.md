# Lista de verificación para el primer lanzamiento de TrendinShop

Esta lista acompaña la preparación del MVP. No sustituye las pruebas en el entorno de producción ni la revisión legal del operador.

## Variables de entorno de producción en Vercel

Configurar los valores en el entorno **Production** del proyecto correcto. No copiar secretos de Preview ni utilizar la base de datos de desarrollo.

- `NEXT_PUBLIC_APP_URL`: URL HTTPS definitiva de TrendinShop.
- `MONGODB_URI`: conexión privada a MongoDB Atlas.
- `MONGODB_DB`: nombre exclusivo de la base de datos de producción, por ejemplo `trendinshop_prod`.
- `AUTH_SECRET`: secreto aleatorio fuerte, independiente de Preview.
- `ADMIN_BOOTSTRAP_KEY`: clave aleatoria fuerte para activar el primer administrador. La activación queda bloqueada definitivamente después de reclamarla.
- `BLOB_READ_WRITE_TOKEN`: token de Vercel Blob para imágenes.
- `CRON_SECRET`: secreto utilizado por tareas programadas.
- `RESEND_API_KEY`: clave de Resend para correos de recuperación de contraseña.
- `AUTH_EMAIL_FROM`: remitente verificado en Resend, por ejemplo `TrendinShop <cuentas@tu-dominio>`.
- `LEGAL_ENTITY_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_ADDRESS`: identidad y contacto reales del operador que aparecerán en la política de privacidad.

La recuperación de contraseña no enviará correos hasta configurar Resend y un remitente verificado. La política de privacidad mostrará una advertencia mientras falten los datos legales del operador.

## Pruebas funcionales antes de abrir el registro

- Crear el primer administrador con la clave de activación y comprobar que una segunda activación falla.
- Crear dos revendedores independientes.
- Crear catálogo, precios y variantes distintos para cada revendedor.
- Desde una sesión cerrada, navegar, armar un carrito y compartirlo. Comprobar que no se permite enviar una compra ni consultar clientes.
- Iniciar sesión como dueño del catálogo, abrir el enlace compartido y registrar una venta asistida.
- Repetir la venta para la misma cédula y comprobar que recupera los datos del directorio de ese revendedor.
- Registrar la misma cédula desde otro revendedor y comprobar que cada directorio mantiene sus propios datos.
- Registrar una cuenta con la cédula de un perfil invitado y comprobar que la identidad se vincula y se actualiza con los datos del registro.
- Iniciar sesión como comprador en otra tienda y verificar el autollenado con los datos de su cuenta y el consentimiento antes de enviar el pedido.
- Comprobar que pedidos pendientes no descuentan inventario y que convertirlos en venta sí lo hace una sola vez.
- Comprobar abonos, cuentas por cobrar, pagos a proveedores, anulaciones y límites de permisos.
- Probar recuperación de contraseña: correo, caducidad del enlace, uso único y cierre de sesiones anteriores.
- Probar que un revendedor no puede consultar o modificar clientes, pedidos, ventas o movimientos de otro revendedor.

## Operación y seguridad

- Confirmar que MongoDB Atlas permite transacciones y que las copias de seguridad están activas.
- Confirmar que las colecciones e índices de los modelos nuevos se han creado: límites de solicitudes, reclamación del primer administrador y tokens de recuperación.
- Revisar registros de errores de Vercel después de cada prueba.
- Comprobar el trabajo programado de limpieza de imágenes.
- Mantener un plan de reversión al despliegue anterior y no ejecutar cambios de esquema destructivos durante el lanzamiento.

## Criterio de salida

No promover a producción hasta completar la configuración de variables, completar la identificación legal del operador, validar los dos revendedores y superar el recorrido de compra asistida y los controles de aislamiento de datos.
