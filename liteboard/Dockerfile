ARG BUILD_FROM
FROM $BUILD_FROM

# Instalar Python 3
RUN apk add --no-cache python3

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar todos los archivos de tu carpeta actual al contenedor
COPY . .

# Arrancar el servidor web simple de Python en el puerto 8000
CMD [ "python3", "-m", "http.server", "8000" ]