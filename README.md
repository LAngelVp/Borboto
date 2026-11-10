# Borboto POS & KDS 🍽️⚡

Sistema web integral para la operación de restaurantes que combina **Punto de Venta (POS)**, **gestión de cocina (KDS)**, mesas, comandas, caja, delivery, clientes, promociones, descuentos, fidelización, facturación y analítica de ventas.

El sistema está diseñado para mantener sincronizadas en tiempo real las operaciones realizadas desde el punto de venta con las pantallas y procesos de cocina.

---

## 🧩 Descripción general

Borboto POS & KDS está compuesto por tres capas principales:

```text
┌─────────────────────────────────────────────┐
│              Cliente Angular                │
│                                             │
│ POS │ Caja │ Mesas │ Cocina │ Delivery     │
│ Clientes │ Productos │ Dashboard │ Config. │
└───────────────────┬─────────────────────────┘
                    │
             REST API / WebSocket
                    │
┌───────────────────▼─────────────────────────┐
│             Backend Node.js                 │
│                 Express                      │
│                                             │
│ Autenticación │ Lógica de negocio           │
│ Ventas │ Comandas │ Caja │ Delivery         │
│ Facturación │ Clientes │ Productos          │
└───────────────────┬─────────────────────────┘
                    │
                    │ SQL / ORM
                    ▼
┌─────────────────────────────────────────────┐
│               PostgreSQL                    │
│                                             │
│ Usuarios │ Clientes │ Productos │ Ventas    │
│ Compras │ Comandas │ Mesas │ Caja           │
│ Promociones │ Fidelidad │ Delivery          │
└─────────────────────────────────────────────┘
```

---

## Empaquetar para Windows

Desde la raiz del proyecto, con Bun instalado:

```bash
bun install --frozen-lockfile
bun run dist
```

El instalador se genera en `dist-electron/`. Incluye Electron, el backend,
las dependencias de produccion, PostgreSQL portable y las migraciones SQL.
El equipo destino no necesita instalar Bun, Node.js ni PostgreSQL por separado.

La aplicacion requiere una licencia valida. Tras activarla, crea su cluster en
`%APPDATA%/borboto/data-pg`, inicializa `borboto_pos` y aplica las migraciones
automaticamente. Las actualizaciones conservan los datos del perfil del usuario.

Antes de probar el instalador, cierra el backend de desarrollo (puerto 3000)
y deten su cluster con:

```bash
./backend-borboto/postgres-bin/bin/pg_ctl.exe -D ./backend-borboto/data-pg stop -m fast
```

No ejecutes simultaneamente desarrollo y la aplicacion instalada con los mismos
puertos (3000 y 58432). Los errores de inicio se muestran en un dialogo; el registro
de PostgreSQL queda en `%APPDATA%/borboto/data-pg/logfile`.
Los archivos `.env`, las claves privadas y los datos de desarrollo no se distribuyen.

## Dictado nativo en la nota de inventario

El boton de microfono usa exclusivamente SpeechRecognition/webkitSpeechRecognition
del navegador, en espanol es-MX. Al mantenerlo presionado solicita el permiso de
microfono si hace falta; los tracks usados para autorizar se cierran inmediatamente.
El texto aparece en vivo sin borrar la nota escrita y queda editable al soltar.
Soltar antes de autorizar o salir de la vista no inicia un microfono tardio.

Si no hay soporte, el permiso no se concede, el servicio nativo falla o la tablet
entra por HTTP en una IP LAN, la app vuelve silenciosamente a la nota con foco y
una guia discreta. Puedes escribir o usar el microfono de tu teclado si el dispositivo
lo ofrece. No se piden flags, modelos, archivos ni paquetes de voz al usuario final.

No se envia audio al backend de Borboto y no existe endpoint de transcripcion.
No hay librerias de voz, workers de inferencia, PowerShell ni modelos incluidos.
El empaquetado es directo con `bun run dist`, sin preparacion de recursos de voz.
Electron solo permite medios/audio al origen propio de la ventana POS; no se
agregan canales IPC de dictado, permisos para camara ni acceso a paginas remotas.

La disponibilidad de dictado depende del navegador/SO/proveedor y puede necesitar
Internet. En Electron puede no existir servicio nativo de reconocimiento. En tablets,
focus solicita el teclado pero no garantiza su despliegue o su microfono: depende
del sistema operativo, configuracion y teclado instalado. El teclado manual permanece
como alternativa; no se promete dictado offline ni universal.

# 🛠️ Stack tecnológico

| Tecnología | Uso                           |
| ---------- | ----------------------------- |
| Node.js    | Runtime del backend           |
| Express.js | API HTTP                      |
| Angular    | Aplicación web                |
| PostgreSQL | Base de datos                 |
| Socket.io  | Comunicación en tiempo real   |
| JWT        | Autenticación                 |
| REST API   | Comunicación cliente-servidor |
| WebSockets | Sincronización POS/KDS        |

---

# 📋 Módulos del sistema

Borboto está dividido en diferentes módulos funcionales.

## ⚙️ Configuración

Módulo central para administrar las configuraciones generales del sistema.

Incluye las opciones necesarias para adaptar el comportamiento del restaurante a su operación.

---

## 💰 Caja

Permite administrar las operaciones relacionadas con caja.

Incluye:

* Apertura de caja.
* Operaciones de caja.
* Movimientos.
* Cortes.
* Cierre de caja.
* Control de operaciones realizadas.
* Impresión de comprobantes.

---

## 🧾 Cortes de caja

Permite realizar el cierre de un periodo de operación de caja.

El corte permite consultar y controlar la información generada durante el turno.

Debe utilizarse al finalizar el periodo correspondiente de operación.

---

## 🖨️ Impresión de tickets

Sistema de impresión de tickets dinámicos.

Los tickets pueden generarse de acuerdo con el tipo de operación y configuración del establecimiento.

El sistema contempla la impresión relacionada con:

* Ventas.
* Comandas.
* Caja.
* Pedidos.
* Operaciones adicionales.

---

## 🧾 Facturación

Módulo destinado a la gestión de facturación.

Permite integrar las operaciones correspondientes a las ventas con el proceso de facturación configurado para el establecimiento.

La implementación específica de facturación depende de los servicios y configuración utilizados por el proyecto.

---

# 🍽️ Comandas

Las comandas representan las órdenes enviadas desde el punto de venta hacia las áreas de preparación.

Flujo general:

```text
Mesero / Cajero
      │
      ▼
Captura pedido
      │
      ▼
Generación de comanda
      │
      ▼
WebSocket
      │
      ▼
Pantalla de cocina
      │
      ▼
Preparación
      │
      ▼
Pedido listo
      │
      ▼
Entrega
```

---

# 👨‍🍳 KDS — Kitchen Display System

El KDS permite administrar las comandas directamente desde cocina.

Estados principales:

```text
PENDIENTE
    ↓
EN PREPARACIÓN
    ↓
LISTO
    ↓
ENTREGADO
```

La comunicación en tiempo real se realiza mediante WebSockets.

Esto permite que una nueva comanda aparezca en cocina sin necesidad de actualizar manualmente la página.

---

# 🪑 Control de mesas

El sistema permite administrar las mesas del establecimiento.

El estado de las mesas puede reflejar la situación actual del salón.

Estados contemplados:

* Libre.
* Ocupada.
* Reservada.
* Por limpiar.

El sistema permite asociar cuentas y pedidos a las mesas correspondientes.

---

# 🔄 Movimiento de cuentas entre mesas

Permite trasladar una cuenta de una mesa a otra.

Ejemplo:

```text
Mesa 05
   │
   │ cuenta activa
   ▼
Mover cuenta
   │
   ▼
Mesa 12
```

La operación debe conservar la información correspondiente de la cuenta y sus productos.

---

# 🛍️ Pedidos de mostrador

Permite administrar pedidos realizados directamente en mostrador.

Estos pedidos pueden seguir un flujo independiente del servicio en mesa.

Flujo:

```text
Cliente
  ↓
Mostrador
  ↓
Pedido
  ↓
Comanda
  ↓
Cocina
  ↓
Preparación
  ↓
Entrega
```

---

# 🚴 Delivery

Módulo destinado a pedidos a domicilio.

Permite gestionar:

* Pedidos.
* Clientes.
* Direcciones.
* Repartidores.
* Estados del envío.
* Seguimiento de entrega.
* Historial de pedidos.

Flujo general:

```text
Pedido
  ↓
Preparación
  ↓
Listo
  ↓
Asignación de repartidor
  ↓
En camino
  ↓
Entregado
```

---

# 👥 Clientes

Módulo para administrar la información de clientes.

Puede incluir:

* Datos generales.
* Historial de compras.
* Información de contacto.
* Preferencias.
* Fidelización.
* Cupones.
* Promociones.
* Pedidos.

---

# ⭐ Fidelización

Permite implementar programas de fidelidad para clientes.

El sistema puede utilizar puntos asociados a las compras para posteriormente permitir su utilización de acuerdo con las reglas configuradas.

Flujo:

```text
Compra
  ↓
Generación de puntos
  ↓
Acumulación
  ↓
Cliente alcanza beneficio
  ↓
Canje
```

---

# 🎟️ Cuponera

Permite administrar cupones y códigos promocionales.

Puede utilizarse para campañas comerciales y beneficios específicos.

Las reglas de aplicación deben validarse antes de confirmar una venta.

---

# 🎁 Promociones

Permite administrar promociones comerciales.

Las promociones pueden utilizarse para establecer condiciones especiales de venta.

La lógica exacta de aplicación depende de las reglas configuradas por el negocio.

---

# 🏷️ Descuentos

Permite aplicar descuentos durante las operaciones de venta.

Los descuentos pueden representar:

* Porcentaje.
* Importe fijo.
* Condiciones específicas.

Las reglas de autorización deben estar relacionadas con los permisos correspondientes.

---

# 🍔 Productos

Módulo para administrar el catálogo del restaurante.

Puede incluir:

* Nombre.
* Descripción.
* Categoría.
* Precio.
* Disponibilidad.
* Inventario.
* Modificadores.
* Información adicional.

---

# 📈 Ventas

Registra las operaciones comerciales realizadas desde el POS.

Las ventas pueden relacionarse con:

* Cliente.
* Productos.
* Mesa.
* Usuario.
* Caja.
* Descuentos.
* Promociones.
* Cupones.
* Forma de pago.
* Delivery.

---

# 📊 Dashboard de ventas

El dashboard proporciona información analítica de las operaciones.

Puede incluir:

* Ventas.
* Productos más vendidos.
* Horas de mayor actividad.
* Indicadores de rendimiento.
* Tendencias.
* Información resumida de ventas.

Las métricas se presentan mediante componentes visuales para facilitar el análisis.

---

# 👤 Usuarios y empleados

El sistema utiliza autenticación y autorización para controlar el acceso.

Los roles contemplados incluyen:

* Administrador.
* Mesero.
* Cocinero.
* Cajero.
* Repartidor.

Los permisos determinan qué módulos y operaciones puede utilizar cada usuario.

---

# 🔐 Autenticación

El sistema utiliza autenticación basada en JWT.

Flujo:

```text
Usuario
  ↓
Login
  ↓
Backend
  ↓
Validación
  ↓
JWT
  ↓
Cliente
  ↓
Solicitudes autenticadas
```

Los tokens deben gestionarse de forma segura y nunca deben almacenarse en repositorios públicos.

---

# 🔌 Comunicación

## REST API

La comunicación tradicional entre Angular y Node.js se realiza mediante API REST.

Se utiliza para operaciones como:

* CRUD.
* Consultas.
* Autenticación.
* Productos.
* Clientes.
* Ventas.
* Configuración.

## WebSockets

Socket.io se utiliza para comunicación en tiempo real.

Especialmente para:

* Comandas.
* KDS.
* Cambios de estado.
* Actualizaciones operativas.
* Sincronización entre usuarios.

---

# 🗄️ Base de datos

Borboto utiliza PostgreSQL.

La base de datos almacena información relacionada con:

* Usuarios.
* Roles.
* Permisos.
* Clientes.
* Productos.
* Ventas.
* Comandas.
* Mesas.
* Caja.
* Compras.
* Promociones.
* Descuentos.
* Fidelización.
* Delivery.
* Configuración.

Las migraciones y cambios estructurales deben gestionarse mediante el mecanismo utilizado actualmente por el proyecto.

---

# ⚙️ Requisitos

Antes de instalar el sistema se requiere:

* Node.js 18 o superior.
* PostgreSQL 15 o superior.
* npm.
* Git.
* Navegador web moderno.

La versión exacta debe coincidir con la configuración del proyecto.

---

# 📥 Instalación

Clonar el repositorio:

```bash
git clone <URL_DEL_REPOSITORIO>
cd borboto
```

Instalar dependencias del backend:

```bash
cd backend
npm install
```

Instalar dependencias del frontend:

```bash
cd frontend
npm install
```

---

# 🔐 Variables de entorno

No almacenar credenciales directamente en el código fuente.

Utilizar archivos de configuración de entorno.

Ejemplo:

```env
NODE_ENV=development

PORT=3000

DATABASE_URL=postgresql://usuario:password@localhost:5432/borboto

JWT_SECRET=CAMBIAR_ESTE_VALOR
```

Los nombres exactos deben corresponder a las variables utilizadas realmente por el proyecto.

**Nunca subir credenciales reales al repositorio.**

---

# ▶️ Ejecución en desarrollo

Backend:

```bash
npm run dev
```

Frontend:

```bash
npm start
```

Los comandos exactos deben verificarse contra los `package.json` del proyecto.

---

# 🏗️ Producción

Antes de desplegar:

1. Configurar variables de entorno.
2. Configurar PostgreSQL.
3. Ejecutar migraciones.
4. Compilar frontend.
5. Preparar backend.
6. Configurar HTTPS.
7. Configurar WebSockets.
8. Verificar impresión.
9. Probar POS.
10. Probar KDS.
11. Probar caja.
12. Probar delivery.
13. Realizar pruebas de facturación.
14. Verificar respaldos.

---

# 🧪 Pruebas recomendadas

## POS

* Crear pedido.
* Agregar productos.
* Modificar pedido.
* Aplicar descuento.
* Aplicar promoción.
* Aplicar cupón.
* Asociar cliente.
* Cobrar venta.
* Imprimir ticket.

## Mesas

* Crear cuenta.
* Agregar productos.
* Mover cuenta.
* Cambiar estado.
* Finalizar cuenta.

## KDS

* Crear comanda.
* Recibir comanda.
* Cambiar estado.
* Marcar como lista.
* Entregar pedido.

## Caja

* Abrir caja.
* Registrar operaciones.
* Realizar corte.
* Cerrar caja.
* Verificar impresión.

## Delivery

* Crear pedido.
* Asignar repartidor.
* Cambiar estado.
* Finalizar entrega.

## Fidelización

* Registrar cliente.
* Generar puntos.
* Consultar saldo.
* Aplicar beneficio.

## Dashboard

* Generar ventas.
* Verificar métricas.
* Verificar productos.
* Comprobar gráficas.

---

# 🔒 Seguridad

Buenas prácticas:

* No subir `.env`.
* No compartir JWT secrets.
* Usar HTTPS en producción.
* Utilizar contraseñas seguras.
* Aplicar permisos mínimos.
* Validar información recibida por API.
* Sanitizar entradas.
* Mantener dependencias actualizadas.
* Realizar respaldos de PostgreSQL.
* Controlar acceso al servidor.

---

# 💾 Respaldos

La base de datos contiene información crítica del negocio.

Se recomienda establecer una política de respaldos que contemple:

* Respaldos automáticos.
* Respaldos periódicos.
* Copias externas.
* Pruebas de restauración.

Un respaldo que nunca ha sido restaurado no debe considerarse completamente verificado.

---

# 🐛 Solución de problemas

## El POS no recibe actualizaciones

Comprobar:

* conexión al backend;
* WebSocket;
* sesión;
* estado del servidor;
* consola del navegador;
* logs del backend.

## Las comandas no aparecen en cocina

Verificar:

1. Backend funcionando.
2. Socket.io funcionando.
3. Usuario autenticado.
4. KDS conectado.
5. Comanda creada correctamente.

## No imprime

Comprobar:

* impresora;
* conexión;
* configuración;
* permisos;
* cola de impresión;
* formato del ticket.

## Error de base de datos

Revisar:

* PostgreSQL;
* credenciales;
* conexión;
* migraciones;
* variables de entorno;
* logs.

---

# 📁 Organización recomendada

```text
borboto/
│
├── backend/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── middleware/
│   ├── sockets/
│   └── ...
│
├── frontend/
│   ├── src/
│   ├── components/
│   ├── services/
│   ├── pages/
│   └── ...
│
├── database/
│
├── docs/
│
├── .env.example
├── package.json
└── README.md
```

La estructura real debe considerarse la fuente de verdad sobre la organización del proyecto.

---

# 🔄 Flujo operativo principal

```text
Cliente
   ↓
POS
   ↓
Pedido
   ↓
Comanda
   ↓
KDS
   ↓
Preparación
   ↓
Listo
   ↓
Entrega
   ↓
Cobro
   ↓
Ticket
   ↓
Venta registrada
   ↓
Dashboard
```

Para delivery:

```text
Pedido
   ↓
POS
   ↓
Comanda
   ↓
Cocina
   ↓
Listo
   ↓
Repartidor
   ↓
En camino
   ↓
Entregado
```

---

# 🤝 Contribución

Antes de realizar cambios:

1. Crear una rama.
2. Implementar el cambio.
3. Probar el módulo afectado.
4. Ejecutar pruebas relacionadas.
5. Verificar que POS y KDS continúen sincronizados.
6. Revisar cambios.
7. Crear Pull Request.

No realizar cambios directamente sobre producción sin validación.

---

# 📜 Licencia

Este proyecto utiliza la licencia definida en el archivo:

```text
LICENSE
```

Si el proyecto utiliza MIT, debe mantenerse el archivo de licencia correspondiente.

---

# 📌 Estado del proyecto

Borboto POS & KDS continúa evolucionando para integrar las operaciones principales de un restaurante en una plataforma centralizada.

Los módulos y funciones disponibles pueden cambiar entre versiones.
