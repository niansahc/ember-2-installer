
!macro customUnInstall
  ; Remove the EmberStartup scheduled task on uninstall
  nsExec::ExecToLog 'schtasks /Delete /TN "EmberStartup" /F'
!macroend