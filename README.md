readme_content = """# Borboto POS & KDS 🍽️⚡

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green?logo=nodedotjs)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-v4.18-lightgrey?logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v15%2B-blue?logo=postgresql)](https://www.postgresql.org/)
[![Angular](https://img.shields.io/badge/Angular-v16%2B-red?logo=angular)](https://angular.io/)
[![WebSockets](https://img.shields.io/badge/Socket.io-v4.6-black?logo=socketdotio)](https://socket.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Borboto POS & KDS** es una solución web integral diseñada para la gestión operativa y comercial de restaurantes en tiempo real. Combina un **Punto de Venta (POS)** ágil e intuitivo con un **Sistema de Pantalla de Cocina (KDS)** dinámico, garantizando la sincronización instantánea entre la sala y la cocina para optimizar los tiempos de respuesta y eliminar errores en el comandeo.

---

## 📋 Tabla de Contenidos

- [Características Principales](#-características-principales)
- [Arquitectura y Stack Tecnológico](#-arquitectura-y-stack-tecnológico)
- [Requisitos Previos](#-requisitos-previos)
- [Instalación y Configuración](#-instalación-y-configuración)
- [Variables de Entorno](#-variables-de-entorno)
- [Modelado de Base de Datos](#-modelado-de-base-de-datos)
- [Uso y Flujo de Trabajo](#-uso-y-flujo-de-trabajo)
- [Contribución](#-contribución)
- [Licencia](#-licencia)

---

## ✨ Características Principales

### 🛒 Punto de Venta (POS)
* **Comandas Ágiles:** Interfaz optimizada para pantallas táctiles, selección rápida de platillos y modificadores de orden (sin cebolla, término de carne, etc.).
* **Gestión de Mesas:** Mapa interactivo del salón con control de estados en tiempo real (libre, ocupada, reservada, por limpiar).
* **Catálogo de Productos:** Administración dinámica de menú, categorías, precios e inventario de insumos.

### 👨‍🍳 Monitor de Cocina en Tiempo Real (KDS)
* **Sincronización Inmediata:** Recepción de comandas al instante vía WebSockets sin necesidad de refrescar la pantalla.
* **Control de Tiempos:** Indicadores visuales de tiempo de espera por pedido con alertas por código de colores (verde, amarillo, rojo).
* **Gestión de Estados:** Actualización simple del flujo de preparación (*Pendiente ➔ En Preparación ➔ Listo ➔ Entregado*).

### 🚴 Pedidos a Domicilio (Delivery)
* **Módulo de Delivery:** Registro de órdenes telefónicas o en línea con asignación y seguimiento de repartidores.
* **Historial de Entregas:** Control del estado del envío y tiempos de entrega.

### 🎟️ Clientes, Fidelización y Promociones
* **Base de Clientes:** Perfil detallado de clientes con registro de preferencias e historial de consumos.
* **Programa de Fidelización:** Sistema de acumulación y canje de puntos por compras realizadas.
* **Cupones y Descuentos:** Configuración de códigos promocionales, descuentos por porcentaje o monto fijo y promociones programadas.

### 📊 Gestión y Analítica
* **Dashboard Analítico:** Gráficos interactivos con métricas de ventas en tiempo real, horas pico y productos más vendidos.
* **Control de Empleados:** Sistema de autenticación JWT y control de acceso basado en roles (Admin, Mesero, Cocinero, Cajero, Repartidor).

---

## 🛠️ Arquitectura y Stack Tecnológico

```text
[ Cliente Angular (POS / KDS) ] <--- WebSockets / REST API ---> [ Server Node.js + Express ] <---> [ Base de Datos PostgreSQL ]