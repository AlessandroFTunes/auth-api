{
  description = "auth-api dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            bun
            git
            postgresql
          ];

          # Postgres local, com dados dentro do projeto (.pgdata, ignorado no git).
          # Subir: pg_ctl -o "-k $PGDATA" -l $PGDATA/log start
          # Parar: pg_ctl stop
          shellHook = ''
            export PGDATA="$PWD/.pgdata"
            export DATABASEURL="postgres://postgres@localhost:5432/auth_api"
            if [ ! -d "$PGDATA" ]; then
              initdb --username=postgres --auth=trust >/dev/null
            fi
          '';
        };
      });
}
