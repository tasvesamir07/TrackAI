# terraform/outputs.tf - Terraform outputs

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_id" {
  description = "Public subnet ID"
  value       = aws_subnet.public.id
}

output "private_subnet_id" {
  description = "Private subnet ID"
  value       = aws_subnet.private.id
}

output "app_server_public_ip" {
  description = "EC2 instance public IP"
  value       = aws_instance.app.public_ip
}

output "app_server_private_ip" {
  description = "EC2 instance private IP"
  value       = aws_instance.app.private_ip
}

output "database_endpoint" {
  description = "RDS database endpoint"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "database_name" {
  description = "Database name"
  value       = aws_db_instance.postgres.db_name
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive   = true
}

output "s3_bucket_name" {
  description = "S3 bucket name for file storage"
  value       = aws_s3_bucket.storage.id
}

output "security_groups" {
  description = "Created security group IDs"
  value = {
    app       = aws_security_group.app.id
    database  = aws_security_group.database.id
    redis     = aws_security_group.redis.id
  }
}