_: {
  perSystem = {pkgs, ...}: let
    inherit
      (pkgs)
      # keep-sorted start
      buildNpmPackage
      fetchurl
      lib
      stdenv
      # keep-sorted end
      ;

    computerUseTarget =
      if stdenv.hostPlatform.isx86_64
      then {
        arch = "x86_64";
        binaryHash = "sha256-ZDLobuZIDzH1CPItvoYNaYeFmZfuR2yjYySjji6030g=";
        cosmicHash = "sha256-pqxi3NcyUksj46uicoFP4XTvsWKRuLkSi2Pot90+LbM=";
        nodeArch = "x64";
      }
      else if stdenv.hostPlatform.isAarch64
      then {
        arch = "aarch64";
        binaryHash = "sha256-1EeXIE7ocVsTak8l0wkl5shw7SmxqBBWr7UNuzHyswI=";
        cosmicHash = "sha256-/uV57JXKUM5/kEpzIMhBJ4UAmo7aB0hVWdG2DYtiQHE=";
        nodeArch = "arm64";
      }
      else throw "pi-suite: unsupported computer-use-linux architecture";

    fetchComputerUse = name: hash:
      fetchurl {
        url = "https://github.com/agent-sh/computer-use-linux/releases/download/v0.4.9/${name}-${computerUseTarget.arch}-unknown-linux-gnu";
        inherit hash;
      };

    computerUseBinary = fetchComputerUse "computer-use-linux" computerUseTarget.binaryHash;
    computerUseCosmic = fetchComputerUse "computer-use-linux-cosmic" computerUseTarget.cosmicHash;

    piSuite = buildNpmPackage {
      pname = "pi-suite";
      version = "0.1.0";

      src = lib.fileset.toSource {
        root = ../.;
        fileset = lib.fileset.unions [
          ../package-lock.json
          ../package.json
          ../src
        ];
      };

      npmDepsHash = "sha256-qViotyOZZwTeivyYoDXIMKaSxyOej0ytqOrVvGg/GeM=";
      npmInstallFlags = [
        "--legacy-peer-deps"
        "--omit=dev"
      ];
      dontNpmBuild = true;

      COMPUTER_USE_LINUX_SKIP_DOWNLOAD = "1";

      installPhase = ''
        runHook preInstall

        computerUseDir="node_modules/@agent-sh/computer-use-linux/npm/bin"
        install -Dm755 ${computerUseBinary} "$computerUseDir/computer-use-linux-linux-${computerUseTarget.nodeArch}"
        install -Dm755 ${computerUseCosmic} "$computerUseDir/computer-use-linux-cosmic"

        mkdir -p "$out"
        cp -r node_modules package.json src "$out/"

        runHook postInstall
      '';
    };
  in {
    packages = {
      default = piSuite;
      pi-suite = piSuite;
    };
  };
}
