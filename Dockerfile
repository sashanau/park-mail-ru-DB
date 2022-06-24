FROM ubuntu:20.04

RUN apt-get -y update

RUN apt-get install -y tzdata
ENV TZ Russia/Moscow
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV PGVER 12
RUN apt-get install -y postgresql-$PGVER

USER postgres

RUN /etc/init.d/postgresql start &&\
  psql --command "CREATE USER api WITH SUPERUSER PASSWORD 'password';" &&\
  createdb -O api api &&\
  /etc/init.d/postgresql stop

RUN echo "host all  all    0.0.0.0/0  md5" >> /etc/postgresql/$PGVER/main/pg_hba.conf
RUN echo "listen_addresses='*'" >> /etc/postgresql/$PGVER/main/postgresql.conf

EXPOSE 5432

VOLUME  ["/etc/postgresql", "/var/log/postgresql", "/var/lib/postgresql"]

USER root

RUN apt-get install -y curl
RUN curl —silent —location https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install -y nodejs
RUN apt-get install -y build-essential

COPY . /api
WORKDIR /api

RUN npm install

EXPOSE 5000

ENV PGPASSWORD password
CMD service postgresql start &&\
  psql -h localhost -d api -U api -p 5432 -a -q -f db/db.sql &&\
  npm start