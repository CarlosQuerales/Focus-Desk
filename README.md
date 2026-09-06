# FocusDesk

FocusDesk es un registro de tiempo local para clientes, proyectos y tareas. Está pensado para mantener un seguimiento confiable incluso si se cierra la pestaña o el equipo entra en suspensión.

## Funciones

- Timer con iniciar, pausar, reanudar y finalizar.
- Clientes y proyectos editables.
- Creación de tareas reutilizables.
- Registro detallado de sesiones y totales diarios.
- Recuperación del tiempo activo después de cerrar la aplicación.
- Respaldo automático en el navegador.
- Base de datos portable en `focusdesk-registro.json`.
- Exportación del historial en CSV.
- Diseño adaptable para escritorio y móvil.

## Cómo funciona el tiempo en segundo plano

Al iniciar una sesión, FocusDesk conserva la hora exacta de comienzo. Si la pestaña se cierra, el contador visual deja de actualizarse, pero al volver a abrirla calcula el tiempo transcurrido desde esa marca. Esto evita perder una sesión por cerrar el navegador o suspender el equipo.

## Desarrollo local

Requiere Node.js 22 o posterior.

```bash
npm install
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`.

## Comprobaciones

```bash
npm run build
npx oxlint app/page.tsx app/layout.tsx lib/file-database.ts
```

Los datos de seguimiento personales no forman parte del repositorio.
