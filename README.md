# SwiftDesk

Portal interno estático con HTML, CSS y JavaScript nativo. La autenticación y los datos del portal, las guardias y las sugerencias usan Firebase Authentication y Cloud Firestore. No hay registro público: un administrador debe dar de alta a cada miembro del equipo.

## Requisitos y costo

- Un proyecto de Firebase con el plan **Spark**.
- Una cuenta de GitHub para publicar los archivos con GitHub Pages. **No necesitas instalar Node.js ni Firebase CLI** para este método.
- El SDK web de Firebase se carga desde el CDN oficial de Google; no hay dependencias de servidor en este proyecto.
- GitHub Pages sirve la web estática; Firebase Authentication y Firestore guardan y protegen los datos. Consulta los límites vigentes del plan Spark antes de usarlo.

## Conectar el proyecto a Firebase

1. En [Firebase Console](https://console.firebase.google.com/), crea un proyecto nuevo o selecciona uno existente. Déjalo en el plan gratuito Spark.
2. En **Authentication → Sign-in method**, habilita **Correo electrónico/contraseña**.
3. En **Authentication → Users**, añade la cuenta inicial del administrador con **Add user**. No compartas la contraseña por canales inseguros.
4. En **Project settings → General → Your apps**, registra una aplicación web (`</>`) o usa la que ya registraste. Copia su configuración web en `firebase-config.js`. La configuración actual de este archivo corresponde al proyecto `swiftdesk-2c03a`; reemplázala solo si vas a usar otro proyecto. Es configuración pública de cliente; **no** pongas claves de cuentas de servicio ni secretos en ese archivo.
5. En **Firestore Database**, crea la base de datos en modo de producción. Selecciona una ubicación cercana al equipo; la ubicación no se puede cambiar después de crear la base.
6. En Firestore, crea manualmente `users/{UID_DEL_ADMIN}`. El UID se copia desde Authentication → Users. Usa exactamente este documento:

   ```json
   {
     "name": "Administrador",
     "email": "admin@empresa.com",
     "role": "admin",
     "department": "Administración"
   }
   ```

7. Abre **Firestore Database → Rules**, reemplaza las reglas de prueba por el contenido del archivo `firestore.rules` y pulsa **Publish**. No publiques el sitio antes de aplicar estas reglas.
8. En GitHub, sube los archivos del proyecto a un repositorio. En el repositorio, ve a **Settings → Pages**, selecciona **Deploy from a branch**, elige la rama donde subiste el código (por ejemplo, `main`) y la carpeta `/ (root)`, y pulsa **Save**. GitHub mostrará la dirección publicada, normalmente `https://USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`.
9. En Firebase Console, ve a **Authentication → Settings → Authorized domains → Add domain** y añade solo el dominio, por ejemplo `USUARIO.github.io` (sin `https://` ni la ruta `/NOMBRE-DEL-REPOSITORIO/`). Si usas un dominio propio, autorízalo también.
10. Abre la dirección de GitHub Pages e inicia sesión con la cuenta administradora del paso 3. En **Gestionar equipo**, un administrador puede crear usuarios con correo y contraseña inicial, cambiar rol o departamento y desactivar el acceso al portal. Si el guardado del perfil falla después de crear la cuenta Auth, la aplicación intenta limpiarla y avisa si debes eliminarla desde Firebase Console.

## Prueba local

Para la primera prueba, publica en GitHub Pages y abre la URL `https://...github.io/...`; los módulos JavaScript de Firebase no funcionan de forma fiable si se abre `index.html` directamente como `file://`. No hace falta configurar un servidor local.

## Colecciones de Firestore

- `users/{uid}`: perfil y rol. Los roles válidos son `admin` y `advisor`.
- `portal/{id}`: publicaciones visibles para ambos roles; el administrador crea, edita y elimina.
- `shifts/{id}`: guardias visibles para ambos roles; el administrador las administra.
- `suggestions/{id}`: buzón privado; cada miembro autenticado envía las suyas y solo los administradores pueden leerlas.

Las reglas de `firestore.rules` deniegan el acceso por defecto y validan autorización, forma de documentos y tamaños en el servidor. Publícalas desde la pestaña Rules de Firestore antes de compartir el enlace. El primer rol administrador se asigna manualmente en Firestore, no mediante la interfaz pública.

Firebase Authentication en Spark no ofrece desde el navegador la API administrativa para borrar o deshabilitar cuentas de otras personas. Desactivar un miembro elimina su perfil `users/{uid}` (con lo que las reglas le niegan acceso a los datos); para eliminar también su cuenta de autenticación, hazlo en Authentication → Users en Firebase Console.

## Notas de privacidad y operación

- GitHub Pages es un sitio público: cualquiera puede abrir la página y descargar el código. El inicio de sesión y las reglas de Firestore protegen los datos, pero no incluyas información privada o contraseñas en los archivos del repositorio. `noindex` pide a buscadores que no indexen la web, pero **no** la vuelve privada. Los encabezados de seguridad declarados en `firebase.json` solo aplican si publicas en Firebase Hosting, no en GitHub Pages.
- El calendario incrustado requiere una URL de inserción válida y accesible para el usuario; se configura desde el botón flotante.
- Las notas rápidas se guardan en `localStorage` del navegador y dispositivo actual: no se sincronizan entre dispositivos ni se incluyen en Firestore.
- El saludo y la detección del turno actual usan la hora local del dispositivo. El banner de novedades y guardia se actualiza en tiempo real con Firestore; no consulta aún una API externa.
- El calculador interpreta el importe con formato USD y aplica `importe mensual × días / 30`.
