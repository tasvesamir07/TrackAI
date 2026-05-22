# terraform/variables.tf - Terraform variables

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "track-ai"
}

variable "environment" {
  description = "Environment (production, staging, development)"
  type        = string
  default     = "production"
}

variable "admin_ip" {
  description = "Your IP address for SSH access"
  type        = string
  default     = "0.0.0.0/32"
}

# VPC Configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR block for public subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "private_subnet_cidr" {
  description = "CIDR block for private subnet"
  type        = string
  default     = "10.0.2.0/24"
}

# Database Configuration
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS in GB"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Maximum allocated storage for RDS in GB"
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "trackai"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "dbadmin"
}

variable "db_password" {
  description = "Database master password (use terraform.tfvars or env var)"
  type        = string
  sensitive   = true
}

# Redis Configuration
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

# EC2 Configuration
variable "ami_id" {
  description = "AMI ID for EC2 instance (Ubuntu 22.04 LTS)"
  type        = string
  default     = "ami-0c55b159cbfafe1f0" # us-east-1 Ubuntu 22.04
}

variable "ec2_instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "ec2_volume_size" {
  description = "Root volume size in GB"
  type        = number
  default     = 30
}

variable "ssh_key_name" {
  description = "SSH key pair name"
  type        = string
  default     = ""
}