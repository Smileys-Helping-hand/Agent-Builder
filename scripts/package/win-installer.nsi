!define OUTPUT_DIR "${OUTPUT_DIR}"
!define BUNDLE_DIR "${BUNDLE_DIR}"

OutFile "${OUTPUT_DIR}\\AgentBuilderSetup.exe"
InstallDir "$PROGRAMFILES\\AgentBuilder"
RequestExecutionLevel admin

Page Directory
Page InstFiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${BUNDLE_DIR}\\*.*"
  CreateShortCut "$DESKTOP\\Agent Builder.lnk" "$INSTDIR\\server\\index.js"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\\Agent Builder.lnk"
  RMDir /r "$INSTDIR"
SectionEnd
