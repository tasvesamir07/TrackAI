# terraform/main.tf - Main Terraform configuration

terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# =====================================
# Network Infrastructure
# =====================================

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name = "${var.project_name}-vpc"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true
  
  tags = {
    Name = "${var.project_name}-public-subnet"
    Type = "public"
  }
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidr
  availability_zone = "${var.aws_region}a"
  
  tags = {
    Name = "${var.project_name}-private-subnet"
    Type = "private"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  
  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  
  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# =====================================
# Security Groups
# =====================================

resource "aws_security_group" "app" {
  name        = "${var.project_name}-app-sg"
  description = "Security group for application servers"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_ip]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "${var.project_name}-app-sg"
  }
}

resource "aws_security_group" "database" {
  name        = "${var.project_name}-db-sg"
  description = "Security group for RDS database"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    description     = "PostgreSQL"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "${var.project_name}-db-sg"
  }
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-redis-sg"
  description = "Security group for ElastiCache Redis"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    description     = "Redis"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  
  tags = {
    Name = "${var.project_name}-redis-sg"
  }
}

# =====================================
# RDS PostgreSQL
# =====================================

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet"
  subnet_ids = [aws_subnet.private.id, aws_subnet.public.id]
  
  tags = {
    Name = "${var.project_name}-db-subnet-group"
  }
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project_name}-postgres"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = var.db_instance_class
  
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage  = var.db_max_allocated_storage
  storage_encrypted      = true
  storage_type           = "gp3"
  
  db_name  = var.db_name
  username = var.db_username
  password = var.db_password
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"
  
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${var.project_name}-final-snapshot" : null
  
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  
  tags = {
    Name = "${var.project_name}-postgres"
  }
}

# =====================================
# ElastiCache Redis
# =====================================

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-redis-subnet"
  subnet_ids = [aws_subnet.private.id]
  
  tags = {
    Name = "${var.project_name}-redis-subnet-group"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.project_name}-redis"
  engine                     = "redis"
  engine_version             = "7.0"
  node_type                  = var.redis_node_type
  number_cache_clusters      = 2
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token_enabled         = true
  
  automatic_failover_enabled = true
  multi_az_enabled          = true
  
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
  
  port = 6379
  
  snapshot_retention_limit   = 7
  snapshot_window           = "03:00-04:00"
  maintenance_window         = "mon:05:00-mon:06:00"
  
  tags = {
    Name = "${var.project_name}-redis"
  }
}

# =====================================
# S3 Bucket for File Storage
# =====================================

resource "aws_s3_bucket" "storage" {
  bucket = "${var.project_name}-storage-${var.environment}"
  
  tags = {
    Name = "${var.project_name}-storage"
  }
}

resource "aws_s3_bucket_versioning" "storage" {
  bucket = aws_s3_bucket.storage.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption" "storage" {
  bucket = aws_s3_bucket.storage.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "storage" {
  bucket = aws_s3_bucket.storage.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# =====================================
# EC2 Instance (Application Server)
# =====================================

resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.ec2_instance_type
  
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = true
  
  key_name = var.ssh_key_name
  
  user_data = templatefile("${path.module}/user-data.tpl", {
    environment = var.environment
    project_name = var.project_name
  })
  
  root_block_device {
    volume_size = var.ec2_volume_size
    volume_type = "gp3"
    encrypted   = true
  }
  
  tags = {
    Name = "${var.project_name}-app-server"
  }
}

# =====================================
# IAM Role for EC2
# =====================================

resource "aws_iam_role" "app_role" {
  name = "${var.project_name}-app-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "s3_access" {
  role       = aws_iam_role.app_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

resource "aws_iam_instance_profile" "app_profile" {
  name = "${var.project_name}-app-profile"
  role = aws_iam_role.app_role.name
}