ARG BUILD_FROM
FROM $BUILD_FROM

# Instala Python y pip
RUN apk add --no-cache python3 py3-pip

# Directorio de trabajo
WORKDIR /app

# Copia el fichero de dependencias e instálalas
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Copia el resto de la aplicación
COPY . .

# Expone el puerto que usará el servidor Flask
EXPOSE 8000

# Comando para arrancar la aplicación
CMD [ "python3", "server.py" ]