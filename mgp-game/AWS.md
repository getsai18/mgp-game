# Servidor en AWS: encender, apagar y actualizar

El juego corre en una instancia EC2 de la cuenta gratuita (plan de créditos, 6 meses).
Cuando no se use, **apagarla** para no gastar crédito.

## Recursos

| Recurso | Valor |
|---|---|
| Cuenta / región | `765951923217` / `us-east-1` |
| Usuario CLI | `claude-deploy` (credenciales en `~/.aws/credentials`, se configuran con `aws configure`) |
| Instancia | `i-02600d141b75fbe8c` (nombre `arena-caos`), `t4g.micro` ARM, Ubuntu 24.04, disco gp3 8 GB |
| Security Group | `arena-caos-sg` (`sg-034b5882f1d3b86fb`): puerto 80 abierto a todos; 22 y 443 (SSH) solo desde `189.202.255.170` |
| Llave SSH | `~/.ssh/arena-caos-key.pem` (usuario `ubuntu`) |
| Alerta de gasto | Budget `alerta-1-usd`: correo si el gasto real pasa de $1 USD/mes |
| App | pm2, proceso `arena`, puerto 80. Código en `/home/ubuntu/mgp-game` |

AWS CLI en Windows: `C:\Program Files\Amazon\AWSCLIV2\aws.exe`. En Git Bash, anteponer
`MSYS_NO_PATHCONV=1` a los comandos que llevan rutas tipo `/dev/sda1`.

## Costo

| Estado | Gasto aprox. |
|---|---|
| Encendida 24/7 | ~$10.40 USD/mes (instancia $6.13 + IP pública $3.65 + disco $0.64) |
| Apagada (stopped) | ~$0.64 USD/mes (solo el disco) |
| Terminada | $0 (se borra todo) |

## Encender

```bash
aws ec2 start-instances --instance-ids i-02600d141b75fbe8c
aws ec2 wait instance-running --instance-ids i-02600d141b75fbe8c
aws ec2 describe-instances --instance-ids i-02600d141b75fbe8c --query "Reservations[0].Instances[0].PublicIpAddress" --output text
```

- **La IP cambia cada vez que se enciende** (no hay Elastic IP: cobra estando apagada).
- pm2 arranca el juego solo al encender. Comprobar en ~1 min: `http://<IP>/health` debe responder `ok`.
- Jugar: `http://<IP>` en dos dispositivos → **JUGAR ONLINE**.

## Apagar

```bash
aws ec2 stop-instances --instance-ids i-02600d141b75fbe8c
```

Desde la consola web: EC2 → Instances → `arena-caos` → Instance state → **Stop instance**.

## Actualizar el juego (después de hacer push a GitHub)

Requiere SSH. **La red de la escuela bloquea el SSH saliente (puertos 22 y 443)**: hacerlo desde otra red.

1. Si la IP de tu red cambió, permitirla en el Security Group:
   ```bash
   aws ec2 authorize-security-group-ingress --group-id sg-034b5882f1d3b86fb --protocol tcp --port 22 --cidr <TU-IP>/32
   ```
2. Entrar y desplegar:
   ```bash
   ssh -i ~/.ssh/arena-caos-key.pem ubuntu@<IP> '/home/ubuntu/update.sh'
   ```
   `update.sh` hace `git pull`, `npm ci`, `npm run build` y reinicia pm2.

## Ver logs sin SSH

```powershell
chcp 65001; $env:PYTHONUTF8 = '1'
aws ec2 get-console-output --instance-id i-02600d141b75fbe8c --latest --query Output --output text
```

El log de la instalación inicial está en `/var/log/arena-setup.log` (y en la consola serie).

## Recrear desde cero

Si la instancia se termina, se recrea con el mismo script de arranque (`user-data`): instala Node 22 y pm2,
clona `https://github.com/getsai18/mgp-game.git` (repo público), hace build y arranca en el puerto 80.
AMI usada: Ubuntu 24.04 ARM de Canonical (owner `099720109477`).
